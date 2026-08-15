import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ConnectorError,
  createStableId,
  type Account,
  type ArticleSearchResult,
  type SourceHealth,
  type Subscription,
  type SyncRun,
} from "../core/index.js";
import { DirectWechatConnector, FeedConnector, type FeedFormat, type FeedReader } from "../connectors/index.js";
import { NodeSqliteAdapter, SqliteRepository, type WechatRepository } from "../storage/index.js";
import { appDataDir } from "../cli/paths.js";
import { DefaultFeedReader, detectFeedFormat } from "./feed-reader.js";
import { safeFetchText } from "./http.js";
import { searchSogou } from "./sogou.js";
import { DefaultWechatFetcher, DefaultWechatParser } from "./wechat.js";

export interface RuntimeHandle {
  service: WechatAgentService;
  databasePath: string;
  close(): void;
}

async function storeResult(repository: WechatRepository, result: ArticleSearchResult): Promise<void> {
  await repository.articles.upsertArticle(result.article);
  for (const source of result.sources) await repository.articles.upsertArticleSource(source);
}

export class WechatAgentService {
  private readonly feedReader: FeedReader;
  private readonly direct: DirectWechatConnector;

  constructor(readonly repository: WechatRepository, options: { feedReader?: FeedReader; direct?: DirectWechatConnector } = {}) {
    this.feedReader = options.feedReader ?? new DefaultFeedReader();
    this.direct = options.direct ?? new DirectWechatConnector(new DefaultWechatFetcher(), new DefaultWechatParser());
  }

  async searchArticles(query: string, options: { scope?: "local" | "global" | "hybrid"; limit?: number } = {}) {
    const scope = options.scope ?? "hybrid";
    const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
    const local = scope === "global" ? [] : await this.repository.articles.searchArticles({ text: query, limit });
    const remote = scope === "local" ? [] : await searchSogou(query, limit);
    for (const result of remote) await storeResult(this.repository, { article: result.article, sources: [result.source] });
    const merged = new Map(local.map((result) => [result.article.id, result]));
    for (const result of remote) merged.set(result.article.id, { article: result.article, sources: [result.source] });
    return [...merged.values()].slice(0, limit);
  }

  async searchAccounts(query: string, limit = 10): Promise<Account[]> {
    const normalized = query.trim().toLocaleLowerCase();
    const local = (await this.repository.accounts.listAccounts()).filter((account) =>
      account.displayName.toLocaleLowerCase().includes(normalized),
    );
    if (local.length >= limit) return local.slice(0, limit);
    const discovered = await searchSogou(query, Math.max(limit * 2, 10));
    const names = new Set(
      discovered.map((item) => item.article.metadata?.accountName).filter((name): name is string => typeof name === "string" && name.length > 0),
    );
    const now = new Date().toISOString();
    for (const name of names) {
      const account: Account = {
        id: createStableId("account", "sogou", name),
        displayName: name,
        identities: [{ connectorId: "sogou", externalId: name, kind: "handle" }],
        createdAt: now,
        updatedAt: now,
        metadata: { discoveryOnly: true },
      };
      await this.repository.accounts.upsertAccount(account);
      local.push(account);
    }
    return [...new Map(local.map((account) => [account.id, account])).values()].slice(0, limit);
  }

  async readArticle(input: { articleId?: string; url?: string }) {
    if (input.articleId) {
      const article = await this.repository.articles.getArticle(input.articleId);
      if (!article) throw new Error(`Article not found: ${input.articleId}`);
      return { article, sources: await this.repository.articles.listArticleSources(article.id) };
    }
    if (!input.url) throw new Error("read requires --url or --article-id");
    let articleUrl = input.url;
    const parsed = new URL(articleUrl);
    if (parsed.hostname === "weixin.sogou.com") {
      const resolved = await safeFetchText(articleUrl, {
        allowedHosts: new Set(["weixin.sogou.com", "mp.weixin.qq.com"]),
        maxBytes: 128 * 1024,
        allowHttp: true,
      });
      const final = new URL(resolved.finalUrl);
      if (
        final.hostname === "weixin.sogou.com" ||
        /antispider|请输入验证码|访问过于频繁/i.test(`${final.pathname} ${resolved.body}`)
      ) {
        throw new ConnectorError("CAPTCHA_REQUIRED", "Sogou requires browser verification before this result can be opened.", {
          retryable: true,
          needsUserAction: true,
        });
      }
      if (final.protocol !== "https:") throw new ConnectorError("SOURCE_UNAVAILABLE", "The search result did not resolve to a secure WeChat URL.");
      articleUrl = resolved.finalUrl;
    }
    const discovered = await this.direct.readArticle(articleUrl, { now: () => new Date() });
    await storeResult(this.repository, { article: discovered.article, sources: [discovered.source] });
    return { article: discovered.article, sources: [discovered.source] };
  }

  async subscribeFeed(feedUrl: string, label?: string): Promise<Subscription> {
    const format = await detectFeedFormat(feedUrl, this.feedReader);
    const now = new Date().toISOString();
    const item: Subscription = {
      id: createStableId("subscription", feedUrl),
      connectorId: `feed:${format}`,
      sourceUrl: new URL(feedUrl).href,
      state: "active",
      createdAt: now,
      updatedAt: now,
      metadata: { format, label: label ?? null },
      ...(label ? { label } : {}),
    };
    return this.repository.subscriptions.upsertSubscription(item);
  }

  async unsubscribe(subscriptionId: string): Promise<boolean> {
    return this.repository.subscriptions.deleteSubscription(subscriptionId);
  }

  async listSubscriptions(): Promise<Subscription[]> {
    return this.repository.subscriptions.listSubscriptions();
  }

  async sync(subscriptionId?: string) {
    const subscriptions = subscriptionId
      ? [await this.repository.subscriptions.getSubscription(subscriptionId)].filter((item): item is Subscription => Boolean(item))
      : await this.repository.subscriptions.listSubscriptions({ activeOnly: true });
    if (subscriptionId && subscriptions.length === 0) throw new Error(`Subscription not found: ${subscriptionId}`);
    const results: SyncRun[] = [];
    for (const subscription of subscriptions) results.push(await this.syncOne(subscription));
    return results;
  }

  private async syncOne(subscription: Subscription): Promise<SyncRun> {
    if (!subscription.sourceUrl) throw new Error(`Subscription ${subscription.id} has no feed URL`);
    const format = String(subscription.metadata?.format ?? subscription.connectorId.split(":")[1]) as FeedFormat;
    const connector = new FeedConnector(subscription.sourceUrl, format, this.feedReader, { id: subscription.connectorId });
    const startedAt = new Date().toISOString();
    let run: SyncRun = {
      id: randomUUID(),
      connectorId: subscription.connectorId,
      subscriptionId: subscription.id,
      status: "running",
      startedAt,
      ...(subscription.cursor ? { cursorBefore: subscription.cursor } : {}),
      articlesDiscovered: 0,
      articlesStored: 0,
    };
    await this.repository.sync.upsertSyncRun(run);
    try {
      const page = await connector.listArticles({ sourceUrl: subscription.sourceUrl, limit: 100, ...(subscription.cursor ? { cursor: subscription.cursor } : {}) }, { now: () => new Date() });
      let stored = 0;
      for (const item of page.items) {
        const existing = await this.repository.articles.getArticle(item.article.id);
        await storeResult(this.repository, { article: item.article, sources: [item.source] });
        if (!existing) stored += 1;
      }
      const completedAt = new Date().toISOString();
      run = {
        ...run,
        status: "succeeded",
        completedAt,
        ...(page.nextCursor ? { cursorAfter: page.nextCursor } : {}),
        articlesDiscovered: page.items.length,
        articlesStored: stored,
      };
      await this.repository.subscriptions.upsertSubscription({
        ...subscription,
        ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
        lastSyncedAt: completedAt,
        updatedAt: completedAt,
      });
      await this.repository.sync.setSourceHealth({
        connectorId: subscription.connectorId,
        state: "healthy",
        checkedAt: completedAt,
        consecutiveFailures: 0,
      });
    } catch (error) {
      const completedAt = new Date().toISOString();
      const connectorError = error instanceof ConnectorError ? error : undefined;
      run = {
        ...run,
        status: connectorError?.needsUserAction ? "needs-user-action" : "failed",
        completedAt,
        errorCode: connectorError?.code ?? "SYNC_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      const previous = await this.repository.sync.getSourceHealth(subscription.connectorId);
      const health: SourceHealth = {
        connectorId: subscription.connectorId,
        state: connectorError?.needsUserAction ? "needs-user-action" : "degraded",
        checkedAt: completedAt,
        consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
        ...(run.errorCode ? { reasonCode: run.errorCode } : {}),
        ...(run.errorMessage ? { message: run.errorMessage } : {}),
      };
      await this.repository.sync.setSourceHealth(health);
    }
    await this.repository.sync.upsertSyncRun(run);
    return run;
  }

  async status(databasePath: string) {
    const [subscriptions, health, recentRuns] = await Promise.all([
      this.repository.subscriptions.listSubscriptions(),
      this.repository.sync.listSourceHealth(),
      this.repository.sync.listSyncRuns({ limit: 10 }),
    ]);
    return {
      databasePath,
      scheduler: { enabled: false, detail: "Synchronization runs only when `wechat-agent sync` is called." },
      subscriptions,
      sourceHealth: health,
      recentSyncRuns: recentRuns,
    };
  }
}

export async function openRuntime(dataRoot = appDataDir()): Promise<RuntimeHandle> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const databasePath = join(dataRoot, "wechat-agent.sqlite");
  const adapter = new NodeSqliteAdapter(databasePath);
  const repository = new SqliteRepository(adapter);
  await repository.initialize();
  return {
    service: new WechatAgentService(repository),
    databasePath,
    close: () => adapter.close(),
  };
}

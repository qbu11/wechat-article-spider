import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ConnectorError,
  createStableId,
  hashArticleContent,
  type Account,
  type Article,
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
import {
  feedUrlMetadata,
  loadFeedUrlSecretKey,
  protectFeedUrl,
  redactSubscription,
  revealFeedUrl,
} from "./feed-url-secret.js";

export interface ArticleSearchOptions {
  scope?: "local" | "global" | "hybrid";
  limit?: number;
  accountName?: string;
  publishedAfter?: string;
  publishedBefore?: string;
}

export interface ArticleSearchResponse {
  results: ArticleSearchResult[];
  warnings: string[];
}

function normalizedAccount(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().normalize("NFC").toLocaleLowerCase();
}

function resultAccountNames(result: ArticleSearchResult): string[] {
  return [
    result.article.metadata?.accountName,
    ...result.sources.flatMap((source) => [source.metadata?.accountName, source.metadata?.feedTitle]),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function articleFingerprint(result: ArticleSearchResult): string | undefined {
  const account = resultAccountNames(result)[0];
  if (!account || !result.article.publishedAt) return undefined;
  const title = result.article.title.replaceAll(/\s+/gu, " ").trim().normalize("NFC").toLocaleLowerCase();
  if (!title) return undefined;
  return `${normalizedAccount(account)}\u0000${title}\u0000${result.article.publishedAt}`;
}

function isDirectWechatArticleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "mp.weixin.qq.com" &&
      (url.pathname === "/s" || url.pathname.startsWith("/s/"));
  } catch {
    return false;
  }
}

function mergeSearchCandidates(candidates: ArticleSearchResult[]): ArticleSearchResult[] {
  const merged = new Map<string, ArticleSearchResult>();
  const fingerprints = new Map<string, string>();
  for (const candidate of candidates) {
    const fingerprint = articleFingerprint(candidate);
    const matchedId = merged.has(candidate.article.id)
      ? candidate.article.id
      : fingerprint ? fingerprints.get(fingerprint) : undefined;
    if (!matchedId) {
      merged.set(candidate.article.id, candidate);
      if (fingerprint) fingerprints.set(fingerprint, candidate.article.id);
      continue;
    }
    const existing = merged.get(matchedId)!;
    const candidateIsOriginal = isDirectWechatArticleUrl(candidate.article.canonicalUrl);
    const existingIsOriginal = isDirectWechatArticleUrl(existing.article.canonicalUrl);
    const preferred = candidateIsOriginal && !existingIsOriginal ? candidate : existing;
    const targetId = preferred.article.id;
    const sources = new Map(
      [...existing.sources, ...candidate.sources].map((source) => [
        source.id,
        source.articleId === targetId ? source : { ...source, articleId: targetId },
      ]),
    );
    if (matchedId !== targetId) merged.delete(matchedId);
    merged.set(targetId, { article: preferred.article, sources: [...sources.values()] });
    if (fingerprint) fingerprints.set(fingerprint, targetId);
  }
  return [...merged.values()];
}

function matchesArticleFilters(result: ArticleSearchResult, options: ArticleSearchOptions): boolean {
  if (options.accountName) {
    const expected = normalizedAccount(options.accountName);
    if (!resultAccountNames(result).some((name) => normalizedAccount(name) === expected)) return false;
  }
  const publishedAt = result.article.publishedAt;
  if (options.publishedAfter && (!publishedAt || publishedAt < options.publishedAfter)) return false;
  if (options.publishedBefore && (!publishedAt || publishedAt > options.publishedBefore)) return false;
  return true;
}

export interface RuntimeHandle {
  service: WechatAgentService;
  databasePath: string;
  close(): void;
}

async function storeResult(repository: WechatRepository, result: ArticleSearchResult): Promise<void> {
  await repository.articles.upsertArticle(result.article);
  for (const source of result.sources) await repository.articles.upsertArticleSource(source);
}

function mergeArticle(existing: Article, incoming: Article): Article {
  const meaningful = (value: string | undefined): string | undefined => value?.trim() ? value : undefined;
  const contentHtml = meaningful(existing.contentHtml) ?? meaningful(incoming.contentHtml);
  const contentMarkdown = meaningful(existing.contentMarkdown) ?? meaningful(incoming.contentMarkdown);
  const merged: Article = {
    ...existing,
    ...incoming,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt > incoming.updatedAt ? existing.updatedAt : incoming.updatedAt,
    ...(incoming.accountId ?? existing.accountId ? { accountId: incoming.accountId ?? existing.accountId } : {}),
    ...(incoming.author ?? existing.author ? { author: incoming.author ?? existing.author } : {}),
    ...(incoming.summary ?? existing.summary ? { summary: incoming.summary ?? existing.summary } : {}),
    ...(contentHtml ? { contentHtml } : {}),
    ...(contentMarkdown ? { contentMarkdown } : {}),
    ...(incoming.publishedAt ?? existing.publishedAt
      ? { publishedAt: incoming.publishedAt ?? existing.publishedAt }
      : {}),
    metadata: { ...existing.metadata, ...incoming.metadata },
  };
  if (!contentHtml) delete merged.contentHtml;
  if (!contentMarkdown) delete merged.contentMarkdown;
  merged.contentHash = hashArticleContent(contentHtml ?? contentMarkdown ?? merged.summary ?? merged.title);
  return merged;
}

function retryableSyncCode(code: string | undefined): boolean {
  return code === "NETWORK_ERROR" || code === "RATE_LIMITED" || code === "SOURCE_UNAVAILABLE" ||
    code === "STALE_CURSOR" || code === "SYNC_FAILED";
}

export class WechatAgentService {
  private readonly feedReader: FeedReader;
  private readonly direct: DirectWechatConnector;
  private readonly articleDiscovery: typeof searchSogou;
  private readonly feedUrlSecretKey: Uint8Array | undefined;
  private readonly syncTails = new Map<string, Promise<void>>();

  constructor(
    readonly repository: WechatRepository,
    options: {
      feedReader?: FeedReader;
      direct?: DirectWechatConnector;
      articleDiscovery?: typeof searchSogou;
      feedUrlSecretKey?: Uint8Array;
    } = {},
  ) {
    this.feedReader = options.feedReader ?? new DefaultFeedReader();
    this.direct = options.direct ?? new DirectWechatConnector(new DefaultWechatFetcher(), new DefaultWechatParser());
    this.articleDiscovery = options.articleDiscovery ?? searchSogou;
    this.feedUrlSecretKey = options.feedUrlSecretKey;
  }

  private async searchLocalArticles(
    text: string | undefined,
    options: ArticleSearchOptions,
    limit: number,
  ): Promise<ArticleSearchResult[]> {
    if (!options.accountName) {
      return this.repository.articles.searchArticles({
        ...(text ? { text } : {}),
        ...(options.publishedAfter ? { publishedAfter: options.publishedAfter } : {}),
        ...(options.publishedBefore ? { publishedBefore: options.publishedBefore } : {}),
        limit,
      });
    }
    const matches: ArticleSearchResult[] = [];
    const pageSize = 200;
    for (let offset = 0; matches.length < limit; offset += pageSize) {
      const page = await this.repository.articles.searchArticles({
        ...(text ? { text } : {}),
        ...(options.publishedAfter ? { publishedAfter: options.publishedAfter } : {}),
        ...(options.publishedBefore ? { publishedBefore: options.publishedBefore } : {}),
        limit: pageSize,
        offset,
      });
      matches.push(...page.filter((result) => matchesArticleFilters(result, options)));
      if (page.length < pageSize) break;
    }
    return matches.slice(0, limit);
  }

  async queryArticles(query: string, options: ArticleSearchOptions = {}): Promise<ArticleSearchResponse> {
    const scope = options.scope ?? "hybrid";
    const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
    const remoteLimit = options.accountName ? Math.min(100, Math.max(limit * 5, 20)) : limit;
    const text = query.trim() || undefined;
    const remoteQuery = [options.accountName, text].filter(Boolean).join(" ");
    const [local, remoteOutcome] = await Promise.all([
      scope === "global"
        ? Promise.resolve([] as ArticleSearchResult[])
        : this.searchLocalArticles(text, options, limit),
      scope === "local"
        ? Promise.resolve({ results: [] as Awaited<ReturnType<typeof searchSogou>>, error: undefined })
        : this.articleDiscovery(remoteQuery, remoteLimit)
            .then((results) => ({ results, error: undefined }))
            .catch((error: unknown) => ({ results: [] as Awaited<ReturnType<typeof searchSogou>>, error })),
    ]);
    const remote = remoteOutcome.results;
    const filteredLocal = local.filter((result) => matchesArticleFilters(result, options));
    if (remoteOutcome.error && (scope === "global" || filteredLocal.length === 0)) throw remoteOutcome.error;
    const filteredRemote = remote
      .map((result) => ({ article: result.article, sources: [result.source] }))
      .filter((result) => matchesArticleFilters(result, options));
    const merged = mergeSearchCandidates([...filteredLocal, ...filteredRemote]);
    for (const result of merged) await storeResult(this.repository, result);
    const results = merged
      .sort((a, b) => (b.article.publishedAt ?? "").localeCompare(a.article.publishedAt ?? ""))
      .slice(0, limit);
    const warnings = remoteOutcome.error
      ? [`Global discovery degraded: ${remoteOutcome.error instanceof Error ? remoteOutcome.error.message : String(remoteOutcome.error)}`]
      : [];
    return { results, warnings };
  }

  async searchArticles(query: string, options: ArticleSearchOptions = {}) {
    return (await this.queryArticles(query, options)).results;
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
    const protectedUrl = protectFeedUrl(feedUrl, this.feedUrlSecretKey);
    const format = await detectFeedFormat(protectedUrl.normalizedUrl, this.feedReader);
    const now = new Date().toISOString();
    const id = createStableId("subscription", protectedUrl.identityUrl);
    const existing = await this.repository.subscriptions.getSubscription(id);
    const item: Subscription = {
      ...existing,
      id,
      connectorId: `feed:${format}:${createStableId("feed", id).slice(-12)}`,
      sourceUrl: protectedUrl.publicUrl,
      state: existing?.state ?? "active",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      metadata: {
        ...existing?.metadata,
        format,
        ...feedUrlMetadata(protectedUrl.encryptedUrl),
        ...(label !== undefined ? { label: label || null } : {}),
      },
      ...(label !== undefined ? (label ? { label } : {}) : existing?.label ? { label: existing.label } : {}),
    };
    if (label !== undefined && !label) delete item.label;
    return redactSubscription(await this.repository.subscriptions.upsertSubscription(item));
  }

  async unsubscribe(subscriptionId: string): Promise<boolean> {
    return this.repository.subscriptions.deleteSubscription(subscriptionId);
  }

  async listSubscriptions(): Promise<Subscription[]> {
    return (await this.repository.subscriptions.listSubscriptions()).map(redactSubscription);
  }

  async sync(subscriptionId?: string) {
    const subscriptions = subscriptionId
      ? [await this.repository.subscriptions.getSubscription(subscriptionId)].filter((item): item is Subscription => Boolean(item))
      : await this.repository.subscriptions.listSubscriptions({ activeOnly: true });
    if (subscriptionId && subscriptions.length === 0) throw new Error(`Subscription not found: ${subscriptionId}`);
    const results: SyncRun[] = [];
    for (const subscription of subscriptions) {
      results.push(await this.withSubscriptionLock(subscription.id, async () => {
        const current = await this.repository.subscriptions.getSubscription(subscription.id);
        if (!current) throw new Error(`Subscription not found: ${subscription.id}`);
        return this.syncOne(current);
      }));
    }
    const failed = results.filter((run) => run.status === "failed" || run.status === "needs-user-action");
    if (failed.length > 0) {
      const partial = failed.length < results.length;
      const targeted = subscriptionId !== undefined;
      throw new ConnectorError(
        targeted
          ? failed[0]?.errorCode ?? "SYNC_FAILED"
          : partial ? "PARTIAL_SYNC_FAILED" : "SYNC_ALL_FAILED",
        targeted
          ? failed[0]?.errorMessage ?? "Synchronization failed"
          : partial
          ? `Synchronization partially failed for ${failed.length} of ${results.length} subscriptions`
          : `Synchronization failed for all ${results.length} subscriptions`,
        {
          retryable: failed.some((run) => retryableSyncCode(run.errorCode)),
          needsUserAction: failed.some((run) => run.status === "needs-user-action"),
        },
      );
    }
    return results;
  }

  private async withSubscriptionLock<T>(subscriptionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.syncTails.get(subscriptionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.syncTails.set(subscriptionId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.syncTails.get(subscriptionId) === tail) this.syncTails.delete(subscriptionId);
    }
  }

  private async syncOne(subscription: Subscription): Promise<SyncRun> {
    const connectorId = subscription.connectorId;
    const startedAt = new Date().toISOString();
    let run: SyncRun = {
      id: randomUUID(),
      connectorId,
      subscriptionId: subscription.id,
      status: "running",
      startedAt,
      ...(subscription.cursor ? { cursorBefore: subscription.cursor } : {}),
      articlesDiscovered: 0,
      articlesStored: 0,
    };
    await this.repository.sync.upsertSyncRun(run);
    try {
      const sourceUrl = revealFeedUrl(subscription, this.feedUrlSecretKey);
      if (!sourceUrl) throw new ConnectorError("INVALID_INPUT", `Subscription ${subscription.id} has no feed URL`);
      const format = String(subscription.metadata?.format ?? subscription.connectorId.split(":")[1]) as FeedFormat;
      const connector = new FeedConnector(sourceUrl, format, this.feedReader, { id: connectorId });
      const page = await connector.listArticles({ sourceUrl, limit: 100, ...(subscription.cursor ? { cursor: subscription.cursor } : {}) }, { now: () => new Date() });
      let stored = 0;
      for (const item of page.items) {
        const existing = await this.repository.articles.getArticle(item.article.id);
        const subscriptionAccount = subscription.label?.trim();
        const incomingArticle = subscriptionAccount
          ? { ...item.article, metadata: { ...item.article.metadata, accountName: subscriptionAccount } }
          : item.article;
        const article = existing ? mergeArticle(existing, incomingArticle) : incomingArticle;
        const source = subscriptionAccount
          ? { ...item.source, metadata: { ...item.source.metadata, accountName: subscriptionAccount } }
          : item.source;
        await storeResult(this.repository, { article, sources: [source] });
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
      await this.repository.transaction(async (repositories) => {
        const current = await repositories.subscriptions.getSubscription(subscription.id);
        if (!current || current.cursor !== subscription.cursor) {
          throw new ConnectorError("STALE_CURSOR", `Subscription ${subscription.id} changed during synchronization`, {
            retryable: true,
          });
        }
        await repositories.subscriptions.upsertSubscription({
          ...current,
          ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
          lastSyncedAt: completedAt,
          updatedAt: completedAt,
        });
      });
      await this.repository.sync.setSourceHealth({
        connectorId,
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
      const previous = await this.repository.sync.getSourceHealth(connectorId);
      const health: SourceHealth = {
        connectorId,
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
      subscriptions: subscriptions.map(redactSubscription),
      sourceHealth: health,
      recentSyncRuns: recentRuns,
    };
  }
}

export async function openRuntime(dataRoot = appDataDir()): Promise<RuntimeHandle> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const feedUrlSecretKey = await loadFeedUrlSecretKey(dataRoot);
  const databasePath = join(dataRoot, "wechat-agent.sqlite");
  const adapter = new NodeSqliteAdapter(databasePath);
  const repository = new SqliteRepository(adapter);
  await repository.initialize();
  return {
    service: new WechatAgentService(repository, { feedUrlSecretKey }),
    databasePath,
    close: () => adapter.close(),
  };
}

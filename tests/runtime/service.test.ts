import { describe, expect, it } from "vitest";
import { ConnectorError, deriveStableArticleIdentity, hashArticleContent } from "../../packages/core/index.js";
import { InMemoryRepository } from "../../packages/storage/index.js";
import type { FeedReader } from "../../packages/connectors/index.js";
import { WechatAgentService } from "../../packages/runtime/service.js";

const reader: FeedReader = {
  async read(url) {
    return {
      format: "rss",
      url,
      title: "示例订阅源",
      items: [
        {
          id: "one",
          title: "持久订阅测试文章",
          url: "https://mp.weixin.qq.com/s/example-token",
          summary: "测试摘要",
          publishedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    };
  },
};

describe("WechatAgentService subscriptions", () => {
  it("persists a feed subscription and synchronizes idempotently", async () => {
    const repository = new InMemoryRepository();
    const service = new WechatAgentService(repository, { feedReader: reader });
    const subscription = await service.subscribeFeed("https://example.com/feed.xml", "示例号");
    expect((await service.listSubscriptions())[0]?.id).toBe(subscription.id);

    const first = await service.sync(subscription.id);
    const second = await service.sync(subscription.id);
    expect(first[0]?.status).toBe("succeeded");
    expect(second[0]?.status).toBe("succeeded");
    expect(first[0]?.articlesStored).toBe(1);
    expect(second[0]?.articlesStored).toBe(0);
    const results = await repository.articles.searchArticles({ text: "持久订阅" });
    expect(results).toHaveLength(1);

    const accountWindow = await service.queryArticles("", {
      scope: "local",
      accountName: "示例号",
      publishedAfter: "2026-08-01T00:00:00.000Z",
      publishedBefore: "2026-08-31T23:59:59.999Z",
    });
    expect(accountWindow.results).toHaveLength(1);
    expect(accountWindow.results[0]?.article.metadata?.accountName).toBe("示例号");

    const outsideWindow = await service.queryArticles("", {
      scope: "local",
      accountName: "示例号",
      publishedAfter: "2026-09-01T00:00:00.000Z",
    });
    expect(outsideWindow.results).toHaveLength(0);
  });

  it("preserves richer direct content when a feed refresh has metadata only", async () => {
    const repository = new InMemoryRepository();
    const service = new WechatAgentService(repository, { feedReader: reader });
    const subscription = await service.subscribeFeed("https://example.com/feed.xml", "示例号");
    const now = "2026-08-14T00:00:00.000Z";
    const articleId = deriveStableArticleIdentity(
      "https://mp.weixin.qq.com/s/example-token",
    );
    await repository.articles.upsertArticle({
      id: articleId.id,
      title: "完整文章",
      canonicalUrl: articleId.canonicalUrl,
      contentHtml: "<p>full body</p>",
      contentMarkdown: "full body",
      contentHash: "sha256:rich",
      createdAt: now,
      updatedAt: now,
    });

    await service.sync(subscription.id);
    expect(await repository.articles.getArticle(articleId.id)).toMatchObject({
      contentHtml: "<p>full body</p>",
      contentMarkdown: "full body",
      contentHash: hashArticleContent("<p>full body</p>"),
      createdAt: now,
    });
  });

  it("treats empty feed bodies as absent and keeps existing full content", async () => {
    const repository = new InMemoryRepository();
    const emptyBodyReader: FeedReader = {
      async read(url) {
        return {
          format: "rss",
          url,
          items: [{ title: "Article", url: "https://mp.weixin.qq.com/s/empty-body", contentHtml: "   " }],
        };
      },
    };
    const service = new WechatAgentService(repository, { feedReader: emptyBodyReader });
    const subscription = await service.subscribeFeed("https://example.com/empty.xml");
    const identity = deriveStableArticleIdentity("https://mp.weixin.qq.com/s/empty-body");
    await repository.articles.upsertArticle({
      id: identity.id,
      title: "Existing",
      canonicalUrl: identity.canonicalUrl,
      contentHtml: "<p>full</p>",
      contentHash: "sha256:stale",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    await service.sync(subscription.id);
    expect(await repository.articles.getArticle(identity.id)).toMatchObject({
      contentHtml: "<p>full</p>",
      contentHash: hashArticleContent("<p>full</p>"),
    });
  });

  it("normalizes subscription identity and preserves sync state when re-subscribing", async () => {
    const repository = new InMemoryRepository();
    const cursorReader: FeedReader = {
      async read(url) {
        return { format: "rss", url, items: [], nextCursor: "cursor-one" };
      },
    };
    const service = new WechatAgentService(repository, { feedReader: cursorReader });
    const first = await service.subscribeFeed("https://example.com:443/feed.xml", "First");
    await service.sync(first.id);
    const second = await service.subscribeFeed("https://example.com/feed.xml", "Second");
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ cursor: "cursor-one", label: "Second" });
    expect(second.lastSyncedAt).toBeTruthy();
    expect(await service.listSubscriptions()).toHaveLength(1);
  });

  it("encrypts private feed queries at rest and redacts every subscription response", async () => {
    const repository = new InMemoryRepository();
    const seen: string[] = [];
    const privateReader: FeedReader = {
      async read(url) {
        seen.push(url);
        return { format: "rss", url, items: [] };
      },
    };
    const service = new WechatAgentService(repository, {
      feedReader: privateReader,
      feedUrlSecretKey: Buffer.alloc(32, 7),
    });
    const subscription = await service.subscribeFeed("https://example.com/private.xml?token=top-secret");
    expect(JSON.stringify(subscription)).not.toContain("top-secret");
    expect(JSON.stringify(await service.listSubscriptions())).not.toContain("top-secret");
    expect(JSON.stringify(await service.status("memory"))).not.toContain("top-secret");
    const stored = await repository.subscriptions.getSubscription(subscription.id);
    expect(stored?.sourceUrl).toBe("https://example.com/private.xml");
    expect(JSON.stringify(stored)).not.toContain("top-secret");
    expect(stored?.metadata?.encryptedSourceUrl).toMatch(/^v1\./u);
    await service.sync(subscription.id);
    expect(seen).toEqual([
      "https://example.com/private.xml?token=top-secret",
      "https://example.com/private.xml?token=top-secret",
    ]);
  });

  it("rotates private feed tokens in place while preserving synchronization state", async () => {
    const repository = new InMemoryRepository();
    const tokenReader: FeedReader = {
      async read(url) {
        return { format: "rss", url, items: [], nextCursor: "cursor-one" };
      },
    };
    const service = new WechatAgentService(repository, {
      feedReader: tokenReader,
      feedUrlSecretKey: Buffer.alloc(32, 9),
    });
    const first = await service.subscribeFeed("https://example.com/private.xml?lang=zh&token=one");
    await service.sync(first.id);
    const rotated = await service.subscribeFeed("https://example.com/private.xml?token=two&lang=zh");
    expect(rotated.id).toBe(first.id);
    expect(rotated.cursor).toBe("cursor-one");
    expect(await service.listSubscriptions()).toHaveLength(1);
  });

  it("records private-feed preflight failures and continues sync-all", async () => {
    const repository = new InMemoryRepository();
    const calls: string[] = [];
    const mixedReader: FeedReader = {
      async read(url) {
        calls.push(url);
        return { format: "rss", url, items: [] };
      },
    };
    const configured = new WechatAgentService(repository, {
      feedReader: mixedReader,
      feedUrlSecretKey: Buffer.alloc(32, 3),
    });
    const privateSubscription = await configured.subscribeFeed("https://example.com/private.xml?token=secret");
    const publicSubscription = await configured.subscribeFeed("https://example.com/public.xml");
    calls.length = 0;
    const missingKey = new WechatAgentService(repository, { feedReader: mixedReader });
    await expect(missingKey.sync()).rejects.toMatchObject({ code: "PARTIAL_SYNC_FAILED" });
    expect(calls).toContain("https://example.com/public.xml");
    expect(await repository.sync.listSyncRuns()).toHaveLength(2);
    expect(await repository.sync.listSourceHealth()).toHaveLength(2);
    expect((await repository.sync.listSyncRuns()).find((run) => run.subscriptionId === privateSubscription.id)?.status)
      .toBe("needs-user-action");
    expect((await repository.sync.listSyncRuns()).find((run) => run.subscriptionId === publicSubscription.id)?.status)
      .toBe("succeeded");
  });

  it("rejects non-HTTPS feed subscriptions before reading them", async () => {
    const feedReader = { read: async () => { throw new Error("must not read"); } };
    const service = new WechatAgentService(new InMemoryRepository(), { feedReader });
    await expect(service.subscribeFeed("http://example.com/feed.xml")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("scans beyond the first repository page for exact account-window matches", async () => {
    const repository = new InMemoryRepository();
    const base = Date.parse("2026-08-01T00:00:00.000Z");
    for (let index = 0; index < 200; index += 1) {
      const timestamp = new Date(base + (index + 2) * 1_000).toISOString();
      await repository.articles.upsertArticle({
        id: `other-${index}`,
        title: "Other post",
        canonicalUrl: `https://example.com/other/${index}`,
        publishedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: { accountName: "Other" },
      });
    }
    const targetTime = new Date(base + 1_000).toISOString();
    await repository.articles.upsertArticle({
      id: "target",
      title: "Target post",
      canonicalUrl: "https://example.com/target",
      publishedAt: targetTime,
      createdAt: targetTime,
      updatedAt: targetTime,
      metadata: { accountName: "Target" },
    });
    const service = new WechatAgentService(repository);
    const result = await service.queryArticles("", { scope: "local", accountName: "Target", limit: 10 });
    expect(result.results.map((item) => item.article.id)).toEqual(["target"]);
  });

  it("serializes concurrent synchronization of the same subscription", async () => {
    const repository = new InMemoryRepository();
    const cursors: Array<string | undefined> = [];
    let calls = 0;
    const cursorReader: FeedReader = {
      async read(url, options) {
        calls += 1;
        if (calls > 1) cursors.push(options.cursor);
        return {
          format: "rss",
          url,
          items: [{ id: "one", url: "https://example.com/article", title: "A" }],
          nextCursor: calls <= 2 ? "cursor-one" : "cursor-two",
        };
      },
    };
    const service = new WechatAgentService(repository, { feedReader: cursorReader });
    const subscription = await service.subscribeFeed("https://example.com/feed");
    const [first, second] = await Promise.all([service.sync(subscription.id), service.sync(subscription.id)]);
    expect(cursors).toEqual([undefined, "cursor-one"]);
    expect([first[0]?.articlesStored, second[0]?.articlesStored]).toEqual([1, 0]);
    expect((await repository.subscriptions.getSubscription(subscription.id))?.cursor).toBe("cursor-two");
  });

  it("keeps source health isolated and surfaces targeted and partial failures", async () => {
    const repository = new InMemoryRepository();
    const counts = new Map<string, number>();
    const mixedReader: FeedReader = {
      async read(url) {
        const count = (counts.get(url) ?? 0) + 1;
        counts.set(url, count);
        if (url.includes("bad") && count > 1) throw new Error("bad feed offline");
        return { format: "rss", url, items: [] };
      },
    };
    const service = new WechatAgentService(repository, { feedReader: mixedReader });
    const bad = await service.subscribeFeed("https://example.com/bad");
    const good = await service.subscribeFeed("https://example.com/good");
    await expect(service.sync(bad.id)).rejects.toMatchObject({ code: "SYNC_FAILED" });
    await expect(service.sync()).rejects.toMatchObject({ code: "PARTIAL_SYNC_FAILED" });
    const health = await repository.sync.listSourceHealth();
    expect(health).toHaveLength(2);
    expect(health.find((item) => item.connectorId === bad.connectorId)?.state).toBe("degraded");
    expect(health.find((item) => item.connectorId === good.connectorId)?.state).toBe("healthy");
  });
});

describe("WechatAgentService hybrid degradation", () => {
  it("returns matching local results with a warning when discovery fails", async () => {
    const repository = new InMemoryRepository();
    const now = "2026-08-15T00:00:00.000Z";
    await repository.articles.upsertArticle({
      id: "article-local",
      title: "本地 AI 文章",
      canonicalUrl: "https://mp.weixin.qq.com/s/local",
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
      metadata: { accountName: "本地号" },
    });
    const service = new WechatAgentService(repository, {
      articleDiscovery: async () => {
        throw new ConnectorError("SOURCE_UNAVAILABLE", "injected outage", { retryable: true });
      },
    });
    const response = await service.queryArticles("AI", { scope: "hybrid" });
    expect(response.results.map((result) => result.article.id)).toEqual(["article-local"]);
    expect(response.warnings).toEqual(["Global discovery degraded: injected outage"]);
  });

  it("does not disguise a discovery failure as an empty success", async () => {
    const service = new WechatAgentService(new InMemoryRepository(), {
      articleDiscovery: async () => {
        throw new ConnectorError("CAPTCHA_REQUIRED", "captcha", { retryable: true, needsUserAction: true });
      },
    });
    await expect(service.queryArticles("AI", { scope: "hybrid" })).rejects.toMatchObject({ code: "CAPTCHA_REQUIRED" });
  });

  it("preserves the original local URL and all provenance when a discovery ID matches", async () => {
    const repository = new InMemoryRepository();
    const now = "2026-08-15T00:00:00.000Z";
    await repository.articles.upsertArticle({
      id: "article-shared",
      title: "共享文章",
      canonicalUrl: "https://mp.weixin.qq.com/s/original",
      createdAt: now,
      updatedAt: now,
      metadata: { accountName: "示例号" },
    });
    await repository.articles.upsertArticleSource({
      id: "source-original",
      articleId: "article-shared",
      connectorId: "feed:rss",
      connectorKind: "rss",
      sourceUrl: "https://mp.weixin.qq.com/s/original",
      discoveredAt: now,
    });
    const service = new WechatAgentService(repository, {
      articleDiscovery: async () => [
        {
          article: {
            id: "article-shared",
            title: "共享文章",
            canonicalUrl: "https://weixin.sogou.com/link?url=temporary",
            createdAt: now,
            updatedAt: now,
            metadata: { accountName: "示例号", discoveryOnly: true },
          },
          source: {
            id: "source-discovery",
            articleId: "article-shared",
            connectorId: "sogou",
            connectorKind: "sogou",
            sourceUrl: "https://weixin.sogou.com/link?url=temporary",
            discoveredAt: now,
          },
        },
      ],
    });
    const response = await service.queryArticles("共享文章", { scope: "hybrid" });
    expect(response.results[0]?.article.canonicalUrl).toBe("https://mp.weixin.qq.com/s/original");
    expect(response.results[0]?.sources.map((source) => source.id).sort()).toEqual(["source-discovery", "source-original"]);
    expect((await repository.articles.getArticle("article-shared"))?.canonicalUrl).toBe("https://mp.weixin.qq.com/s/original");
  });

  it("reconciles exact Sogou and direct identities without relying on matching ID namespaces", async () => {
    const repository = new InMemoryRepository();
    const now = "2026-08-15T00:00:00.000Z";
    const identity = deriveStableArticleIdentity(
      "https://mp.weixin.qq.com/s?__biz=MzA1&mid=123&idx=1",
    );
    await repository.articles.upsertArticle({
      id: identity.id,
      title: "同一篇文章",
      canonicalUrl: identity.canonicalUrl,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
      metadata: { accountName: "示例号" },
    });
    await repository.articles.upsertArticleSource({
      id: "direct-source",
      articleId: identity.id,
      connectorId: "feed:rss:one",
      connectorKind: "rss",
      sourceUrl: identity.canonicalUrl,
      discoveredAt: now,
      metadata: { accountName: "示例号" },
    });
    const service = new WechatAgentService(repository, {
      articleDiscovery: async () => [{
        article: {
          id: "article_sogou_namespace",
          title: "同一篇文章",
          canonicalUrl: "https://weixin.sogou.com/link?url=opaque",
          publishedAt: now,
          createdAt: now,
          updatedAt: now,
          metadata: { accountName: "示例号", discoveryOnly: true },
        },
        source: {
          id: "sogou-source",
          articleId: "article_sogou_namespace",
          connectorId: "sogou",
          connectorKind: "sogou",
          sourceUrl: "https://weixin.sogou.com/link?url=opaque",
          discoveredAt: now,
          publishedAt: now,
          metadata: { accountName: "示例号" },
        },
      }],
    });
    const response = await service.queryArticles("同一篇文章", { scope: "hybrid" });
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.article.id).toBe(identity.id);
    expect(response.results[0]?.sources.map((source) => source.id).sort()).toEqual([
      "direct-source",
      "sogou-source",
    ]);
    expect((await repository.articles.listArticleSources(identity.id)).map((source) => source.id).sort()).toEqual([
      "direct-source",
      "sogou-source",
    ]);
  });
});

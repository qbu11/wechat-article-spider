import { describe, expect, it } from "vitest";
import { ConnectorError } from "../../packages/core/index.js";
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
});

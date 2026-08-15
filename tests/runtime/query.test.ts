import { describe, expect, it } from "vitest";
import type { ArticleSearchResult } from "../../packages/core/index.js";
import {
  createFastQueryEnvelope,
  inferArticleQueryIntent,
  parseDateBoundary,
  toFastArticleJson,
} from "../../packages/runtime/query.js";

const originalResult: ArticleSearchResult = {
  article: {
    id: "article-one",
    title: "Agent 查询契约",
    summary: "紧凑结果",
    publishedAt: "2026-08-10T08:00:00.000Z",
    canonicalUrl: "https://mp.weixin.qq.com/s/original",
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T08:00:00.000Z",
    metadata: { accountName: "示例公众号" },
  },
  sources: [
    {
      id: "source-one",
      articleId: "article-one",
      connectorId: "feed:atom",
      connectorKind: "atom",
      sourceUrl: "https://mp.weixin.qq.com/s/original",
      discoveredAt: "2026-08-10T08:00:00.000Z",
    },
  ],
};

describe("fast article query contract", () => {
  it("distinguishes keyword and account-window intents deterministically", () => {
    expect(inferArticleQueryIntent({ keywords: "AI", scope: "hybrid", limit: 10 })).toBe("keyword-search");
    expect(inferArticleQueryIntent({ account: "示例公众号", scope: "hybrid", limit: 10 })).toBe("account-window");
    expect(() => inferArticleQueryIntent({ intent: "account-window", keywords: "AI", scope: "local", limit: 5 })).toThrow(
      "requires --account",
    );
  });

  it("normalizes inclusive date-only boundaries", () => {
    expect(parseDateBoundary("2026-08-01", "after")).toBe("2026-08-01T00:00:00.000Z");
    expect(parseDateBoundary("2026-08-15", "before")).toBe("2026-08-15T23:59:59.999Z");
  });

  it("returns compact JSON with a verified original link", () => {
    expect(toFastArticleJson(originalResult)).toMatchObject({
      account: "示例公众号",
      originalUrl: "https://mp.weixin.qq.com/s/original",
      discoveryUrl: null,
      linkKind: "original",
    });
    const envelope = createFastQueryEnvelope(
      { account: "示例公众号", after: "2026-08-01T00:00:00.000Z", scope: "local", limit: 10 },
      [originalResult],
      12.4,
    );
    expect(envelope).toMatchObject({
      intent: { kind: "account-window", account: "示例公众号" },
      mode: "fast-links",
      count: 1,
      elapsedMs: 12,
      warnings: [],
    });
  });

  it("never labels a Sogou redirect as an original URL", () => {
    const discovery = structuredClone(originalResult);
    discovery.article.canonicalUrl = "https://weixin.sogou.com/link?url=opaque";
    discovery.sources[0]!.connectorId = "sogou";
    discovery.sources[0]!.connectorKind = "sogou";
    discovery.sources[0]!.sourceUrl = discovery.article.canonicalUrl;
    expect(toFastArticleJson(discovery)).toMatchObject({
      originalUrl: null,
      discoveryUrl: discovery.article.canonicalUrl,
      linkKind: "discovery",
    });
  });
});

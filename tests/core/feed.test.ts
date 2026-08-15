import { describe, expect, it } from "vitest";
import { FeedConnector, mapFeedItem } from "../../packages/connectors/index.js";

const now = new Date("2026-08-15T00:00:00.000Z");

describe("FeedConnector", () => {
  it("maps feed items to canonical articles with provenance", () => {
    const item = mapFeedItem(
      { format: "rss", url: "https://feed.example/rss", title: "Feed" },
      {
        id: "entry-1",
        url: "https://mp.weixin.qq.com/s?__biz=MzA1&mid=1&idx=1&scene=2",
        title: "文章",
        contentText: "正文",
      },
      "feed-1",
      now,
    );
    expect(item.article.id).toMatch(/^wx_/u);
    expect(item.source.connectorKind).toBe("rss");
    expect(item.source.externalId).toBe("entry-1");
  });

  it("preserves reader cursors", async () => {
    const connector = new FeedConnector(
      "https://feed.example/rss",
      "rss",
      {
        read: async () => ({
          format: "rss",
          url: "https://feed.example/rss",
          items: [{ url: "https://example.com/a", title: "A" }],
          nextCursor: "next",
        }),
      },
      { id: "feed-1" },
    );
    const page = await connector.listArticles({}, { now: () => now });
    expect(page.nextCursor).toBe("next");
    expect(page.items).toHaveLength(1);
  });
});

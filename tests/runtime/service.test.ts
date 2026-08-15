import { describe, expect, it } from "vitest";
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
  });
});

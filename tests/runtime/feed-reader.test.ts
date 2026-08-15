import { describe, expect, it } from "vitest";
import { parseFeedDocument } from "../../packages/runtime/feed-reader.js";

describe("parseFeedDocument", () => {
  it("parses RSS, Atom, and JSON Feed into one item shape", () => {
    const rss = parseFeedDocument(
      `<rss><channel><title>RSS 示例</title><item><guid>1</guid><title>文章一</title><link>https://mp.weixin.qq.com/s/token1</link><description>摘要</description></item></channel></rss>`,
      "application/rss+xml",
      "https://example.com/rss",
    );
    const atom = parseFeedDocument(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom 示例</title><entry><id>2</id><title>文章二</title><link href="https://mp.weixin.qq.com/s/token2"/></entry></feed>`,
      "application/atom+xml",
      "https://example.com/atom",
    );
    const json = parseFeedDocument(
      JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "JSON 示例", items: [{ id: "3", title: "文章三", url: "https://mp.weixin.qq.com/s/token3" }] }),
      "application/feed+json",
      "https://example.com/feed.json",
    );
    expect([rss.format, atom.format, json.format]).toEqual(["rss", "atom", "json-feed"]);
    expect([rss.items[0]?.title, atom.items[0]?.title, json.items[0]?.title]).toEqual(["文章一", "文章二", "文章三"]);
  });
});

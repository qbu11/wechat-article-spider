import { describe, expect, it } from "vitest";
import { ConnectorError } from "../../packages/core/index.js";
import {
  DirectWechatConnector,
  parseWechatArticleUrl,
} from "../../packages/connectors/index.js";

const articleUrl = "https://mp.weixin.qq.com/s?__biz=MzA1&mid=123&idx=1";
const context = { now: () => new Date("2026-08-15T00:00:00.000Z") };

describe("DirectWechatConnector", () => {
  it("accepts only WeChat HTTPS article URLs", () => {
    expect(parseWechatArticleUrl(articleUrl).biz).toBe("MzA1");
    expect(() => parseWechatArticleUrl("http://mp.weixin.qq.com/s?id=1")).toThrow(
      ConnectorError,
    );
    expect(() => parseWechatArticleUrl("https://example.com/s?id=1")).toThrow(ConnectorError);
  });

  it("returns a canonical article and source record", async () => {
    const connector = new DirectWechatConnector(
      {
        fetch: async (requestedUrl) => ({
          requestedUrl,
          finalUrl: articleUrl,
          status: 200,
          html: "<html></html>",
        }),
      },
      { parse: () => ({ title: "  测试文章  ", contentHtml: "<p>正文</p>" }) },
    );

    const result = await connector.readArticle(articleUrl, context);
    expect(result.article.title).toBe("测试文章");
    expect(result.article.id).toMatch(/^wx_[a-f0-9]{64}$/u);
    expect(result.source.articleId).toBe(result.article.id);
  });

  it("rejects a redirect outside the WeChat article host", async () => {
    const connector = new DirectWechatConnector(
      {
        fetch: async (requestedUrl) => ({
          requestedUrl,
          finalUrl: "https://127.0.0.1/private",
          status: 200,
          html: "",
        }),
      },
      { parse: () => ({ title: "never reached" }) },
    );

    await expect(connector.readArticle(articleUrl, context)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

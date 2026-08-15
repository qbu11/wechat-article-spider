import { describe, expect, it } from "vitest";
import {
  createStableId,
  deriveStableArticleIdentity,
  extractWechatArticleCoordinates,
  normalizeUrl,
} from "../../packages/core/index.js";

describe("stable article identity", () => {
  it("prefers WeChat __biz + mid + idx over transient query parameters", () => {
    const first = deriveStableArticleIdentity(
      "https://mp.weixin.qq.com/s?__biz=MzA1&mid=123&idx=2&scene=21&sn=first",
    );
    const second = deriveStableArticleIdentity(
      "https://mp.weixin.qq.com/s?idx=2&mid=123&__biz=MzA1&from=timeline&sn=second",
    );

    expect(first.id).toBe(second.id);
    expect(first.strategy).toBe("wechat-coordinates");
    expect(first.canonicalUrl).toBe(
      "https://mp.weixin.qq.com/s?__biz=MzA1&mid=123&idx=2",
    );
  });

  it("falls back to a normalized URL hash", () => {
    const first = deriveStableArticleIdentity("https://example.com/post?utm_source=x&id=7#top");
    const second = deriveStableArticleIdentity("https://example.com/post?id=7&utm_source=y");
    expect(first.id).toBe(second.id);
    expect(first.strategy).toBe("canonical-url");
  });

  it("requires all three WeChat coordinates", () => {
    expect(
      extractWechatArticleCoordinates("https://mp.weixin.qq.com/s?__biz=MzA1&mid=123"),
    ).toBeUndefined();
  });

  it("removes tracking and sorts query parameters", () => {
    expect(normalizeUrl("https://EXAMPLE.com:443/x?z=2&utm_medium=a&a=1#x").href).toBe(
      "https://example.com/x?a=1&z=2",
    );
  });

  it("does not remove ambiguous parameters from non-WeChat URLs", () => {
    expect(normalizeUrl("https://example.com/x?from=archive&version=2").href).toBe(
      "https://example.com/x?from=archive&version=2",
    );
  });

  it("rejects unsafe stable ID prefixes", () => {
    expect(() => createStableId("../bad", "x")).toThrow(TypeError);
  });
});

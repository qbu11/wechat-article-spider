import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "../../packages/core/index.js";
import { parseSogouResults, searchSogou } from "../../packages/runtime/sogou.js";

const fixturePath = join(process.cwd(), "tests", "runtime", "fixtures", "sogou-result.html");

describe("parseSogouResults", () => {
  it("keeps article and source IDs stable when temporary URL tokens change", async () => {
    const fixture = await readFile(fixturePath, "utf8");
    const first = parseSogouResults(
      fixture
        .replaceAll("TEMPORARY_URL", "opaque-one")
        .replaceAll("TEMPORARY_TOKEN", "token-one")
        .replaceAll("QUERY", "first-query"),
      { now: new Date("2026-08-15T00:00:00.000Z") },
    )[0]!;
    const second = parseSogouResults(
      fixture
        .replaceAll("TEMPORARY_URL", "opaque-two")
        .replaceAll("TEMPORARY_TOKEN", "token-two")
        .replaceAll("QUERY", "second-query"),
      { now: new Date("2026-08-16T00:00:00.000Z") },
    )[0]!;

    expect(first.article.id).toBe(second.article.id);
    expect(first.source.id).toBe(second.source.id);
    expect(first.source.sourceUrl).not.toBe(second.source.sourceUrl);
    expect(first.article.metadata?.publicationHint).toBe("1786752000");
    expect(first.article.publishedAt).toBe("2026-08-15T00:00:00.000Z");
    expect(first.source.publishedAt).toBe(first.article.publishedAt);
  });

  it("does not use relative display dates as durable identity", async () => {
    const fixture = (await readFile(fixturePath, "utf8")).replace(
      "<script>document.write(timeConvert('1786752000'))</script>",
      "RELATIVE_DATE",
    );
    const yesterday = parseSogouResults(fixture.replace("RELATIVE_DATE", "昨天"))[0]!;
    const today = parseSogouResults(fixture.replace("RELATIVE_DATE", "今天"))[0]!;

    expect(yesterday.article.id).toBe(today.article.id);
    expect(yesterday.article.metadata?.publicationHint).toBeUndefined();
  });

  it("rejects result links outside Sogou and direct WeChat article hosts", () => {
    const html = `<ul class="news-list"><li><div class="txt-box"><h3><a href="https://evil.example/phish">Fake</a></h3></div></li></ul>`;
    expect(parseSogouResults(html)).toEqual([]);
  });

  it("rejects result links with embedded credentials", () => {
    const html = `<ul class="news-list"><li><div class="txt-box"><h3><a href="https://user:TOPSECRET@mp.weixin.qq.com/s/example">Fake</a></h3></div></li></ul>`;
    expect(parseSogouResults(html)).toEqual([]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchSogou failure classification", () => {
  it("returns a machine-readable CAPTCHA error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("请输入验证码", { status: 200 })));
    const error = await searchSogou("测试", 1).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ code: "CAPTCHA_REQUIRED", retryable: true, needsUserAction: true });
  });

  it("classifies rate limits as retryable source failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("slow down", { status: 429 })));
    const error = await searchSogou("测试", 1).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "SOURCE_UNAVAILABLE", retryable: true, needsUserAction: false });
  });
});

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DefaultWechatParser } from "../../packages/runtime/wechat.js";

const fixtures = join(process.cwd(), "tests", "fixtures");

async function parse(name: string) {
  const html = await readFile(join(fixtures, name), "utf8");
  return new DefaultWechatParser().parse({
    requestedUrl: "https://mp.weixin.qq.com/s/example",
    finalUrl: "https://mp.weixin.qq.com/s/example",
    status: 200,
    html,
  });
}

describe("DefaultWechatParser", () => {
  it.each([
    ["article_normal.html", "示例技术周报"],
    ["article_image.html", "示例图片故事"],
    ["article_video.html", "示例视频访谈"],
  ])("parses %s", async (fixture, title) => {
    expect((await parse(fixture)).title).toBe(title);
  });

  it("classifies verification pages without storing them as articles", async () => {
    await expect(parse("article_blocked.html")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("classifies deleted articles", async () => {
    await expect(parse("article_expired.html")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSogouResults } from "../../packages/runtime/sogou.js";

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
});

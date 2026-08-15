import { describe, expect, it } from "vitest";
import { planArticleTextSearch } from "../../packages/storage/index.js";

describe("article text search planner", () => {
  it("uses trigram FTS for terms of at least three Unicode code points", () => {
    const plan = planArticleTextSearch("人工智能", { fts5TrigramAvailable: true });
    expect(plan.mode).toBe("fts5-trigram");
    expect(plan.joinSql).toContain("article_fts");
    expect(plan.parameters).toEqual(['"人工智能"']);
  });

  it("falls back to LIKE when any token is shorter than three code points", () => {
    const plan = planArticleTextSearch("AI 微信", { fts5TrigramAvailable: true });
    expect(plan.mode).toBe("like");
    expect(plan.parameters).toHaveLength(4);
  });

  it("escapes LIKE wildcard characters", () => {
    const plan = planArticleTextSearch("10%_", { fts5TrigramAvailable: false });
    expect(plan.parameters[0]).toBe("%10\\%\\_%");
  });

  it("returns a recent-articles plan for blank input", () => {
    expect(planArticleTextSearch("  ", { fts5TrigramAvailable: true }).mode).toBe("recent");
  });
});

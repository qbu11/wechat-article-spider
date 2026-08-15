import { describe, expect, it } from "vitest";
import {
  applySqliteMigrations,
  sqliteMigrations,
  type SqliteAdapter,
} from "../../packages/storage/index.js";

describe("SQLite migrations", () => {
  it("contains the domain tables and optional trigram index", () => {
    expect(sqliteMigrations[0]?.sql).toContain("CREATE TABLE accounts");
    expect(sqliteMigrations[0]?.sql).toContain("CREATE TABLE subscriptions");
    expect(sqliteMigrations[1]).toMatchObject({ optionalFeature: "fts5-trigram" });
    expect(sqliteMigrations[1]?.sql).toContain("tokenize='trigram'");
  });

  it("degrades when optional FTS5 is unavailable", async () => {
    const executed: string[] = [];
    const adapter: SqliteAdapter = {
      exec: async (sql) => {
        executed.push(sql);
        if (sql.includes("CREATE VIRTUAL TABLE")) throw new Error("no such module: fts5");
      },
      all: async () => [],
    };

    const result = await applySqliteMigrations(adapter);
    expect(result.applied).toEqual([1]);
    expect(result.skippedOptional).toEqual([
      expect.objectContaining({ version: 2, feature: "fts5-trigram" }),
    ]);
    expect(executed).toContain("ROLLBACK");
  });
});

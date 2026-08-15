import { afterEach, describe, expect, it } from "vitest";
import type { Account, Article } from "../../packages/core/index.js";
import {
  NodeSqliteAdapter,
  SqliteRepository,
} from "../../packages/storage/index.js";

const now = "2026-08-15T00:00:00.000Z";

describe("SqliteRepository", () => {
  const adapters: NodeSqliteAdapter[] = [];
  afterEach(() => {
    for (const adapter of adapters.splice(0)) adapter.close();
  });

  it("migrates and persists domain records", async () => {
    const adapter = new NodeSqliteAdapter(":memory:");
    adapters.push(adapter);
    const repository = new SqliteRepository(adapter);
    const migration = await repository.initialize();
    expect(migration.applied).toContain(1);

    const account: Account = {
      id: "account-1",
      displayName: "测试号",
      identities: [{ connectorId: "rss-1", externalId: "test-feed", kind: "feed-url" }],
      createdAt: now,
      updatedAt: now,
    };
    const article: Article = {
      id: "article-1",
      accountId: account.id,
      title: "人工智能周报",
      contentMarkdown: "这是持久化正文",
      canonicalUrl: "https://example.com/article-1",
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await repository.transaction(async ({ accounts, articles }) => {
      await accounts.upsertAccount(account);
      await articles.upsertArticle(article);
    });

    expect(
      await repository.accounts.findAccountByIdentity("rss-1", "test-feed"),
    ).toMatchObject({ id: account.id, identities: account.identities });
    const found = await repository.articles.searchArticles({ text: "人工智能" });
    expect(found.map((result) => result.article.id)).toEqual([article.id]);
  });

  it("rolls back failed transactions", async () => {
    const adapter = new NodeSqliteAdapter(":memory:");
    adapters.push(adapter);
    const repository = new SqliteRepository(adapter);
    await repository.initialize();

    await expect(
      repository.transaction(async ({ accounts }) => {
        await accounts.upsertAccount({
          id: "rolled-back",
          displayName: "rollback",
          identities: [],
          createdAt: now,
          updatedAt: now,
        });
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await repository.accounts.getAccount("rolled-back")).toBeUndefined();
  });
});

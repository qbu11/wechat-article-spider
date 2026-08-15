import { describe, expect, it } from "vitest";
import type { Account, Article, ArticleSource } from "../../packages/core/index.js";
import { InMemoryRepository } from "../../packages/storage/index.js";

const timestamp = "2026-08-15T00:00:00.000Z";

function account(): Account {
  return {
    id: "account-1",
    displayName: "示例公众号",
    identities: [{ connectorId: "feed-1", externalId: "example" }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function article(): Article {
  return {
    id: "article-1",
    accountId: "account-1",
    title: "一篇关于智能体的文章",
    contentMarkdown: "本地全文索引",
    canonicalUrl: "https://example.com/article-1",
    publishedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function source(): ArticleSource {
  return {
    id: "source-1",
    articleId: "article-1",
    connectorId: "feed-1",
    connectorKind: "rss",
    sourceUrl: "https://example.com/article-1",
    discoveredAt: timestamp,
  };
}

describe("InMemoryRepository", () => {
  it("stores and searches an article with provenance", async () => {
    const repository = new InMemoryRepository();
    await repository.accounts.upsertAccount(account());
    await repository.articles.upsertArticle(article());
    await repository.articles.upsertArticleSource(source());

    const results = await repository.articles.searchArticles({
      text: "全文",
      connectorId: "feed-1",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.sources[0]?.id).toBe("source-1");
  });

  it("rolls back all writes when a transaction fails", async () => {
    const repository = new InMemoryRepository();
    await expect(
      repository.transaction(async ({ accounts, articles }) => {
        await accounts.upsertAccount(account());
        await articles.upsertArticle(article());
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect(await repository.accounts.listAccounts()).toEqual([]);
    expect(await repository.articles.getArticle("article-1")).toBeUndefined();
  });

  it("does not expose mutable internal objects", async () => {
    const repository = new InMemoryRepository({ accounts: [account()] });
    const stored = await repository.accounts.getAccount("account-1");
    stored!.displayName = "mutated";
    expect((await repository.accounts.getAccount("account-1"))?.displayName).toBe("示例公众号");
  });
});

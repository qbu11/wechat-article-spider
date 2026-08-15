import type {
  Account,
  Article,
  ArticleSearchQuery,
  ArticleSearchResult,
  ArticleSource,
  SourceHealth,
  Subscription,
  SyncRun,
} from "../../../core/src/index.js";
import type {
  AccountRepository,
  ArticleRepository,
  RepositoryTransaction,
  SubscriptionRepository,
  SyncRepository,
  WechatRepository,
} from "../repository.js";
import { planArticleTextSearch } from "../search-query-planner.js";
import {
  applySqliteMigrations,
  hasFts5Trigram,
  type MigrationResult,
  type SqliteAdapter,
} from "./migrations.js";

export interface SqliteRepositoryAdapter extends SqliteAdapter {
  run(sql: string, parameters?: readonly unknown[]): void | Promise<void>;
}

type Row = Record<string, unknown>;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value || value === "{}") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function requiredString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new TypeError(`SQLite row is missing string column ${key}`);
  return value;
}

function accountFromRow(row: Row, identities: Account["identities"]): Account {
  return {
    id: requiredString(row, "id"),
    displayName: requiredString(row, "display_name"),
    identities,
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
    ...(optionalString(row.description) ? { description: optionalString(row.description)! } : {}),
    ...(optionalString(row.avatar_url) ? { avatarUrl: optionalString(row.avatar_url)! } : {}),
    ...(parseMetadata(row.metadata_json) ? { metadata: parseMetadata(row.metadata_json)! } : {}),
  };
}

function articleFromRow(row: Row): Article {
  const optional = (column: string, property: keyof Article): Partial<Article> => {
    const value = optionalString(row[column]);
    return value ? ({ [property]: value } as Partial<Article>) : {};
  };
  return {
    id: requiredString(row, "id"),
    title: requiredString(row, "title"),
    canonicalUrl: requiredString(row, "canonical_url"),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
    ...optional("account_id", "accountId"),
    ...optional("author", "author"),
    ...optional("summary", "summary"),
    ...optional("content_html", "contentHtml"),
    ...optional("content_markdown", "contentMarkdown"),
    ...optional("published_at", "publishedAt"),
    ...optional("content_hash", "contentHash"),
    ...(parseMetadata(row.metadata_json) ? { metadata: parseMetadata(row.metadata_json)! } : {}),
  };
}

function articleSourceFromRow(row: Row): ArticleSource {
  return {
    id: requiredString(row, "id"),
    articleId: requiredString(row, "article_id"),
    connectorId: requiredString(row, "connector_id"),
    connectorKind: requiredString(row, "connector_kind"),
    sourceUrl: requiredString(row, "source_url"),
    discoveredAt: requiredString(row, "discovered_at"),
    ...(optionalString(row.external_id) ? { externalId: optionalString(row.external_id)! } : {}),
    ...(optionalString(row.fetched_at) ? { fetchedAt: optionalString(row.fetched_at)! } : {}),
    ...(optionalString(row.published_at) ? { publishedAt: optionalString(row.published_at)! } : {}),
    ...(parseMetadata(row.metadata_json) ? { metadata: parseMetadata(row.metadata_json)! } : {}),
  };
}

function subscriptionFromRow(row: Row): Subscription {
  const interval = typeof row.interval_minutes === "number" ? row.interval_minutes : undefined;
  const jitter = typeof row.jitter_minutes === "number" ? row.jitter_minutes : undefined;
  return {
    id: requiredString(row, "id"),
    connectorId: requiredString(row, "connector_id"),
    state: requiredString(row, "state") as Subscription["state"],
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
    ...(optionalString(row.account_id) ? { accountId: optionalString(row.account_id)! } : {}),
    ...(optionalString(row.external_account_id)
      ? { externalAccountId: optionalString(row.external_account_id)! }
      : {}),
    ...(optionalString(row.source_url) ? { sourceUrl: optionalString(row.source_url)! } : {}),
    ...(optionalString(row.label) ? { label: optionalString(row.label)! } : {}),
    ...(optionalString(row.cursor) ? { cursor: optionalString(row.cursor)! } : {}),
    ...(interval !== undefined
      ? { schedule: { intervalMinutes: interval, ...(jitter !== undefined ? { jitterMinutes: jitter } : {}) } }
      : {}),
    ...(optionalString(row.last_synced_at)
      ? { lastSyncedAt: optionalString(row.last_synced_at)! }
      : {}),
    ...(parseMetadata(row.metadata_json) ? { metadata: parseMetadata(row.metadata_json)! } : {}),
  };
}

function syncRunFromRow(row: Row): SyncRun {
  return {
    id: requiredString(row, "id"),
    connectorId: requiredString(row, "connector_id"),
    status: requiredString(row, "status") as SyncRun["status"],
    startedAt: requiredString(row, "started_at"),
    articlesDiscovered: Number(row.articles_discovered),
    articlesStored: Number(row.articles_stored),
    ...(optionalString(row.subscription_id)
      ? { subscriptionId: optionalString(row.subscription_id)! }
      : {}),
    ...(optionalString(row.completed_at) ? { completedAt: optionalString(row.completed_at)! } : {}),
    ...(optionalString(row.cursor_before) ? { cursorBefore: optionalString(row.cursor_before)! } : {}),
    ...(optionalString(row.cursor_after) ? { cursorAfter: optionalString(row.cursor_after)! } : {}),
    ...(optionalString(row.error_code) ? { errorCode: optionalString(row.error_code)! } : {}),
    ...(optionalString(row.error_message) ? { errorMessage: optionalString(row.error_message)! } : {}),
    ...(parseMetadata(row.metadata_json) ? { metadata: parseMetadata(row.metadata_json)! } : {}),
  };
}

function sourceHealthFromRow(row: Row): SourceHealth {
  return {
    connectorId: requiredString(row, "connector_id"),
    state: requiredString(row, "state") as SourceHealth["state"],
    checkedAt: requiredString(row, "checked_at"),
    consecutiveFailures: Number(row.consecutive_failures),
    ...(optionalString(row.retry_after) ? { retryAfter: optionalString(row.retry_after)! } : {}),
    ...(optionalString(row.reason_code) ? { reasonCode: optionalString(row.reason_code)! } : {}),
    ...(optionalString(row.message) ? { message: optionalString(row.message)! } : {}),
    ...(typeof row.latency_ms === "number" ? { latencyMs: row.latency_ms } : {}),
    ...(parseMetadata(row.metadata_json) ? { metadata: parseMetadata(row.metadata_json)! } : {}),
  };
}

export class SqliteRepository implements WechatRepository {
  private transactionTail: Promise<unknown> = Promise.resolve();
  private fts5TrigramAvailable = false;

  readonly accounts: AccountRepository;
  readonly articles: ArticleRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly sync: SyncRepository;

  constructor(private readonly db: SqliteRepositoryAdapter) {
    this.accounts = {
      upsertAccount: async (account) => {
        await this.db.run(
          `INSERT INTO accounts(id, display_name, description, avatar_url, created_at, updated_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, description=excluded.description,
avatar_url=excluded.avatar_url, updated_at=excluded.updated_at, metadata_json=excluded.metadata_json`,
          [account.id, account.displayName, account.description ?? null, account.avatarUrl ?? null,
            account.createdAt, account.updatedAt, JSON.stringify(account.metadata ?? {})],
        );
        await this.db.run("DELETE FROM account_identities WHERE account_id = ?", [account.id]);
        for (const identity of account.identities) {
          await this.db.run(
            "INSERT INTO account_identities(account_id, connector_id, external_id, kind) VALUES (?, ?, ?, ?)",
            [account.id, identity.connectorId, identity.externalId, identity.kind ?? null],
          );
        }
        return account;
      },
      getAccount: async (id) => {
        const rows = await this.db.all<Row>("SELECT * FROM accounts WHERE id = ?", [id]);
        return rows[0] ? this.hydrateAccount(rows[0]) : undefined;
      },
      findAccountByIdentity: async (connectorId, externalId) => {
        const rows = await this.db.all<Row>(
          `SELECT a.* FROM accounts a JOIN account_identities i ON i.account_id = a.id
WHERE i.connector_id = ? AND i.external_id = ? LIMIT 1`,
          [connectorId, externalId],
        );
        return rows[0] ? this.hydrateAccount(rows[0]) : undefined;
      },
      listAccounts: async () => {
        const rows = await this.db.all<Row>("SELECT * FROM accounts ORDER BY display_name, id");
        return Promise.all(rows.map((row) => this.hydrateAccount(row)));
      },
    };

    this.articles = {
      upsertArticle: async (article) => {
        await this.db.run(
          `INSERT INTO articles(id, account_id, title, author, summary, content_html, content_markdown,
published_at, canonical_url, content_hash, created_at, updated_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id, title=excluded.title,
author=excluded.author, summary=excluded.summary, content_html=excluded.content_html,
content_markdown=excluded.content_markdown, published_at=excluded.published_at,
canonical_url=excluded.canonical_url, content_hash=excluded.content_hash,
updated_at=excluded.updated_at, metadata_json=excluded.metadata_json`,
          [article.id, article.accountId ?? null, article.title, article.author ?? null,
            article.summary ?? null, article.contentHtml ?? null, article.contentMarkdown ?? null,
            article.publishedAt ?? null, article.canonicalUrl, article.contentHash ?? null,
            article.createdAt, article.updatedAt, JSON.stringify(article.metadata ?? {})],
        );
        return article;
      },
      getArticle: async (id) => {
        const rows = await this.db.all<Row>("SELECT * FROM articles WHERE id = ?", [id]);
        return rows[0] ? articleFromRow(rows[0]) : undefined;
      },
      upsertArticleSource: async (source) => {
        await this.db.run(
          `INSERT INTO article_sources(id, article_id, connector_id, connector_kind, external_id,
source_url, discovered_at, fetched_at, published_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET article_id=excluded.article_id, external_id=excluded.external_id,
source_url=excluded.source_url, discovered_at=excluded.discovered_at, fetched_at=excluded.fetched_at,
published_at=excluded.published_at, metadata_json=excluded.metadata_json`,
          [source.id, source.articleId, source.connectorId, source.connectorKind,
            source.externalId ?? null, source.sourceUrl, source.discoveredAt, source.fetchedAt ?? null,
            source.publishedAt ?? null, JSON.stringify(source.metadata ?? {})],
        );
        return source;
      },
      listArticleSources: async (articleId) => {
        const rows = await this.db.all<Row>(
          "SELECT * FROM article_sources WHERE article_id = ? ORDER BY discovered_at, id",
          [articleId],
        );
        return rows.map(articleSourceFromRow);
      },
      searchArticles: async (query) => this.searchArticles(query),
    };

    this.subscriptions = {
      upsertSubscription: async (item) => {
        await this.db.run(
          `INSERT INTO subscriptions(id, account_id, connector_id, external_account_id, source_url,
label, state, cursor, interval_minutes, jitter_minutes, created_at, updated_at, last_synced_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id, connector_id=excluded.connector_id,
external_account_id=excluded.external_account_id, source_url=excluded.source_url, label=excluded.label,
state=excluded.state, cursor=excluded.cursor, interval_minutes=excluded.interval_minutes,
jitter_minutes=excluded.jitter_minutes, updated_at=excluded.updated_at,
last_synced_at=excluded.last_synced_at, metadata_json=excluded.metadata_json`,
          [item.id, item.accountId ?? null, item.connectorId, item.externalAccountId ?? null,
            item.sourceUrl ?? null, item.label ?? null, item.state, item.cursor ?? null,
            item.schedule?.intervalMinutes ?? null, item.schedule?.jitterMinutes ?? null,
            item.createdAt, item.updatedAt, item.lastSyncedAt ?? null, JSON.stringify(item.metadata ?? {})],
        );
        return item;
      },
      getSubscription: async (id) => {
        const rows = await this.db.all<Row>("SELECT * FROM subscriptions WHERE id = ?", [id]);
        return rows[0] ? subscriptionFromRow(rows[0]) : undefined;
      },
      listSubscriptions: async (options) => {
        const rows = await this.db.all<Row>(
          `SELECT * FROM subscriptions ${options?.activeOnly ? "WHERE state = 'active'" : ""} ORDER BY created_at, id`,
        );
        return rows.map(subscriptionFromRow);
      },
      deleteSubscription: async (id) => {
        const before = await this.db.all<Row>("SELECT id FROM subscriptions WHERE id = ?", [id]);
        await this.db.run("DELETE FROM subscriptions WHERE id = ?", [id]);
        return before.length > 0;
      },
    };

    this.sync = {
      upsertSyncRun: async (run) => {
        await this.db.run(
          `INSERT INTO sync_runs(id, connector_id, subscription_id, status, started_at, completed_at,
cursor_before, cursor_after, articles_discovered, articles_stored, error_code, error_message, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET status=excluded.status, completed_at=excluded.completed_at,
cursor_after=excluded.cursor_after, articles_discovered=excluded.articles_discovered,
articles_stored=excluded.articles_stored, error_code=excluded.error_code,
error_message=excluded.error_message, metadata_json=excluded.metadata_json`,
          [run.id, run.connectorId, run.subscriptionId ?? null, run.status, run.startedAt,
            run.completedAt ?? null, run.cursorBefore ?? null, run.cursorAfter ?? null,
            run.articlesDiscovered, run.articlesStored, run.errorCode ?? null,
            run.errorMessage ?? null, JSON.stringify(run.metadata ?? {})],
        );
        return run;
      },
      getSyncRun: async (id) => {
        const rows = await this.db.all<Row>("SELECT * FROM sync_runs WHERE id = ?", [id]);
        return rows[0] ? syncRunFromRow(rows[0]) : undefined;
      },
      listSyncRuns: async (options) => {
        const where: string[] = [];
        const parameters: unknown[] = [];
        if (options?.connectorId) {
          where.push("connector_id = ?");
          parameters.push(options.connectorId);
        }
        if (options?.subscriptionId) {
          where.push("subscription_id = ?");
          parameters.push(options.subscriptionId);
        }
        parameters.push(Math.max(0, options?.limit ?? 100));
        const rows = await this.db.all<Row>(
          `SELECT * FROM sync_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
ORDER BY started_at DESC LIMIT ?`,
          parameters,
        );
        return rows.map(syncRunFromRow);
      },
      setSourceHealth: async (health) => {
        await this.db.run(
          `INSERT INTO source_health(connector_id, state, checked_at, consecutive_failures,
retry_after, reason_code, message, latency_ms, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(connector_id) DO UPDATE SET state=excluded.state, checked_at=excluded.checked_at,
consecutive_failures=excluded.consecutive_failures, retry_after=excluded.retry_after,
reason_code=excluded.reason_code, message=excluded.message, latency_ms=excluded.latency_ms,
metadata_json=excluded.metadata_json`,
          [health.connectorId, health.state, health.checkedAt, health.consecutiveFailures,
            health.retryAfter ?? null, health.reasonCode ?? null, health.message ?? null,
            health.latencyMs ?? null, JSON.stringify(health.metadata ?? {})],
        );
        return health;
      },
      getSourceHealth: async (connectorId) => {
        const rows = await this.db.all<Row>("SELECT * FROM source_health WHERE connector_id = ?", [connectorId]);
        return rows[0] ? sourceHealthFromRow(rows[0]) : undefined;
      },
      listSourceHealth: async () => {
        const rows = await this.db.all<Row>("SELECT * FROM source_health ORDER BY connector_id");
        return rows.map(sourceHealthFromRow);
      },
    };
  }

  async initialize(): Promise<MigrationResult> {
    const result = await applySqliteMigrations(this.db);
    this.fts5TrigramAvailable = await hasFts5Trigram(this.db);
    return result;
  }

  async transaction<T>(work: (repositories: RepositoryTransaction) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await this.db.exec("BEGIN IMMEDIATE");
      const result = await work(this);
      await this.db.exec("COMMIT");
      return result;
    } catch (error) {
      await Promise.resolve(this.db.exec("ROLLBACK")).catch(() => undefined);
      throw error;
    } finally {
      release();
    }
  }

  private async hydrateAccount(row: Row): Promise<Account> {
    const identities = await this.db.all<Row>(
      "SELECT connector_id, external_id, kind FROM account_identities WHERE account_id = ? ORDER BY connector_id, external_id",
      [requiredString(row, "id")],
    );
    return accountFromRow(
      row,
      identities.map((identity) => ({
        connectorId: requiredString(identity, "connector_id"),
        externalId: requiredString(identity, "external_id"),
        ...(optionalString(identity.kind)
          ? {
              kind: optionalString(identity.kind)! as NonNullable<
                Account["identities"][number]["kind"]
              >,
            }
          : {}),
      })),
    );
  }

  private async searchArticles(query: ArticleSearchQuery): Promise<ArticleSearchResult[]> {
    const plan = planArticleTextSearch(query.text, {
      fts5TrigramAvailable: this.fts5TrigramAvailable,
    });
    const where = [plan.whereSql];
    const parameters: unknown[] = [...plan.parameters];
    if (query.accountId) {
      where.push("a.account_id = ?");
      parameters.push(query.accountId);
    }
    if (query.connectorId) {
      where.push(
        "EXISTS (SELECT 1 FROM article_sources filtered_source WHERE filtered_source.article_id = a.id AND filtered_source.connector_id = ?)",
      );
      parameters.push(query.connectorId);
    }
    if (query.publishedAfter) {
      where.push("a.published_at >= ?");
      parameters.push(query.publishedAfter);
    }
    if (query.publishedBefore) {
      where.push("a.published_at <= ?");
      parameters.push(query.publishedBefore);
    }
    parameters.push(Math.max(0, Math.min(query.limit ?? 20, 200)), Math.max(0, query.offset ?? 0));
    const rows = await this.db.all<Row>(
      `SELECT DISTINCT a.* FROM articles a ${plan.joinSql}
WHERE ${where.join(" AND ")} ORDER BY a.published_at DESC, a.id LIMIT ? OFFSET ?`,
      parameters,
    );
    return Promise.all(
      rows.map(async (row) => {
        const article = articleFromRow(row);
        return { article, sources: await this.articles.listArticleSources(article.id) };
      }),
    );
  }
}

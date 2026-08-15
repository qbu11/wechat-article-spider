export interface SqliteMigration {
  version: number;
  name: string;
  sql: string;
  optionalFeature?: "fts5-trigram";
}

export interface SqliteAdapter {
  exec(sql: string): void | Promise<void>;
  all<T extends Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): T[] | Promise<T[]>;
}

export const sqliteMigrations: readonly SqliteMigration[] = [
  {
    version: 1,
    name: "initial-domain-schema",
    sql: `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE account_identities (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  kind TEXT,
  PRIMARY KEY (connector_id, external_id)
);
CREATE INDEX account_identities_account_idx ON account_identities(account_id);

CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  author TEXT,
  summary TEXT,
  content_html TEXT,
  content_markdown TEXT,
  published_at TEXT,
  canonical_url TEXT NOT NULL,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX articles_canonical_url_idx ON articles(canonical_url);
CREATE INDEX articles_account_published_idx ON articles(account_id, published_at DESC);

CREATE TABLE article_sources (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  connector_kind TEXT NOT NULL,
  external_id TEXT,
  source_url TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  fetched_at TEXT,
  published_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX article_sources_article_idx ON article_sources(article_id);
CREATE INDEX article_sources_connector_idx ON article_sources(connector_id, external_id);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  connector_id TEXT NOT NULL,
  external_account_id TEXT,
  source_url TEXT,
  label TEXT,
  state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'needs-user-action', 'disabled')),
  cursor TEXT,
  interval_minutes INTEGER CHECK (interval_minutes IS NULL OR interval_minutes >= 1),
  jitter_minutes INTEGER CHECK (jitter_minutes IS NULL OR jitter_minutes >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_synced_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX subscriptions_due_idx ON subscriptions(state, last_synced_at);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  cursor_before TEXT,
  cursor_after TEXT,
  articles_discovered INTEGER NOT NULL DEFAULT 0 CHECK (articles_discovered >= 0),
  articles_stored INTEGER NOT NULL DEFAULT 0 CHECK (articles_stored >= 0),
  error_code TEXT,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX sync_runs_subscription_started_idx ON sync_runs(subscription_id, started_at DESC);

CREATE TABLE source_health (
  connector_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  retry_after TEXT,
  reason_code TEXT,
  message TEXT,
  latency_ms REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
`,
  },
  {
    version: 2,
    name: "article-fts5-trigram",
    optionalFeature: "fts5-trigram",
    sql: `
CREATE VIRTUAL TABLE article_fts USING fts5(
  article_id UNINDEXED,
  title,
  author,
  summary,
  content_markdown,
  tokenize='trigram'
);

INSERT INTO article_fts(article_id, title, author, summary, content_markdown)
SELECT id, title, COALESCE(author, ''), COALESCE(summary, ''), COALESCE(content_markdown, '')
FROM articles;

CREATE TRIGGER articles_fts_insert AFTER INSERT ON articles BEGIN
  INSERT INTO article_fts(article_id, title, author, summary, content_markdown)
  VALUES (new.id, new.title, COALESCE(new.author, ''), COALESCE(new.summary, ''), COALESCE(new.content_markdown, ''));
END;

CREATE TRIGGER articles_fts_delete AFTER DELETE ON articles BEGIN
  DELETE FROM article_fts WHERE article_id = old.id;
END;

CREATE TRIGGER articles_fts_update AFTER UPDATE ON articles BEGIN
  DELETE FROM article_fts WHERE article_id = old.id;
  INSERT INTO article_fts(article_id, title, author, summary, content_markdown)
  VALUES (new.id, new.title, COALESCE(new.author, ''), COALESCE(new.summary, ''), COALESCE(new.content_markdown, ''));
END;
`,
  },
] as const;

export interface MigrationResult {
  applied: number[];
  skippedOptional: Array<{ version: number; feature: string; reason: string }>;
}

/**
 * Adapter-neutral migration runner. Optional FTS installation degrades cleanly
 * to LIKE search when a SQLite build lacks FTS5 or the trigram tokenizer.
 */
export async function applySqliteMigrations(adapter: SqliteAdapter): Promise<MigrationResult> {
  await adapter.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);`);
  const rows = await adapter.all<{ version: number }>("SELECT version FROM schema_migrations");
  const appliedVersions = new Set(rows.map((row) => Number(row.version)));
  const result: MigrationResult = { applied: [], skippedOptional: [] };

  for (const migration of sqliteMigrations) {
    if (appliedVersions.has(migration.version)) continue;
    try {
      await adapter.exec("BEGIN IMMEDIATE");
      await adapter.exec(migration.sql);
      const escapedName = migration.name.replaceAll("'", "''");
      await adapter.exec(
        `INSERT INTO schema_migrations(version, name, applied_at) VALUES (${migration.version}, '${escapedName}', CURRENT_TIMESTAMP)`,
      );
      await adapter.exec("COMMIT");
      result.applied.push(migration.version);
    } catch (error) {
      await Promise.resolve(adapter.exec("ROLLBACK")).catch(() => undefined);
      if (migration.optionalFeature) {
        result.skippedOptional.push({
          version: migration.version,
          feature: migration.optionalFeature,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      throw error;
    }
  }
  return result;
}

export async function hasFts5Trigram(adapter: SqliteAdapter): Promise<boolean> {
  const rows = await adapter.all<{ found: number }>(
    "SELECT 1 AS found FROM schema_migrations WHERE version = 2 LIMIT 1",
  );
  return rows.length > 0;
}

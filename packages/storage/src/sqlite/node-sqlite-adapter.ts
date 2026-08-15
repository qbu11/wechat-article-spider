import { DatabaseSync, type DatabaseSyncOptions } from "node:sqlite";
import type { SqliteRepositoryAdapter } from "./repository.js";

/** Node.js built-in SQLite adapter. No native npm dependency is required. */
export class NodeSqliteAdapter implements SqliteRepositoryAdapter, Disposable {
  readonly database: DatabaseSync;

  constructor(path: string, options: DatabaseSyncOptions = {}) {
    this.database = new DatabaseSync(path, options);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  all<T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): T[] {
    const statement = this.database.prepare(sql);
    return statement.all(...(parameters as Parameters<typeof statement.all>)) as unknown as T[];
  }

  run(sql: string, parameters: readonly unknown[] = []): void {
    const statement = this.database.prepare(sql);
    statement.run(...(parameters as Parameters<typeof statement.run>));
  }

  close(): void {
    this.database.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

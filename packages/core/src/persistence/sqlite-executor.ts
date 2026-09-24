import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { getDb } from "./db";

/**
 * SQLite アダプタ共通の薄い実行面。ドメインはこれを直接使わず、
 * 各ドメイン Repository の SQLite 実装だけが依存する。
 */
export type SqliteExecutor = {
  run(sql: string, ...params: SQLInputValue[]): void;
  all<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[];
  get<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T | undefined;
  /** トランザクション等で生接続が必要なときだけ。 */
  raw(): DatabaseSync;
};

export function createSqliteExecutor(): SqliteExecutor {
  return {
    run(sql: string, ...params: SQLInputValue[]): void {
      getDb().prepare(sql).run(...params);
    },
    all<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
      return getDb().prepare(sql).all(...params) as T[];
    },
    get<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T | undefined {
      return getDb().prepare(sql).get(...params) as T | undefined;
    },
    raw(): DatabaseSync {
      return getDb();
    },
  };
}

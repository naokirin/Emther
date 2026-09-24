import type { AgentRun, LogLine } from "./types";

/**
 * agent_runs / agent_run_logs の永続化ポート。
 * ドメインは SQL / getDb を知らない。
 */
export type AgentRunRepository = {
  insertRunLog(runId: string, line: LogLine): void;
  upsertRunMeta(run: AgentRun): void;
  /** 起動時 hydrate 用。メタデータにログ行を結合した AgentRun を返す。 */
  loadAllRunsWithLogs(): AgentRun[];
  /** バッチ二重起動ガード用: origin × 時刻範囲に run があるか。 */
  existsByOriginInRange(origin: string, start: number, end: number): boolean;
  minCreatedAtByOriginInRange(origin: string, start: number, end: number): number | null;
  listCreatedAtByOriginSince(origin: string, since: number): number[];
};

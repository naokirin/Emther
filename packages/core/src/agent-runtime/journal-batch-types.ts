/** Journal集約解釈の永続ウォーターマーク（auto-journal-batch.json）。 */
export type JournalBatchPersisted = {
  /** claimedHours が属するローカル暦日 YYYY-MM-DD */
  date: string | null;
  /** その日に既に消化した設定時刻スロット（0〜23） */
  claimedHours: number[];
  /** 前回の集約解釈がカバーした時刻。次回 begin 時の sinceExclusive になる */
  lastCoveredAt: number | null;
  /** 進行中（または直近）の集約解釈の固定窓。プロセス再起動後の decideRun 再注入用 */
  activeSinceExclusive: number | null;
  activeUntil: number | null;
  /**
   * 旧形式 `{ date }` のみから読んだとき true。
   */
  legacyDateOnly?: boolean;
};

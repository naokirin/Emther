import { createJsonSingletonDocument } from "../json-document";
import { createSqliteExecutor, type SqliteExecutor } from "../sqlite-executor";

export type DistillationPersistedRaw = {
  week?: string | null;
  claimedWeekdays?: unknown;
};

/**
 * 自動バッチの二重起動ガード用 JSON マーカー群 + SQLite claim。
 * ドメイン（scheduled-tasks）はファイル名 / SQL を知らない。
 */
export type ScheduleMarkersRepository = {
  loadMorningSummaryDate(): string | null;
  saveMorningSummaryDate(date: string): void;
  loadDistillationRaw(): DistillationPersistedRaw;
  saveDistillation(state: { week: string | null; claimedWeekdays: number[] }): void;
  loadGrowWeek(): string | null;
  saveGrowWeek(week: string): void;
  loadWeeklyReportWeek(): string | null;
  saveWeeklyReportWeek(week: string): void;
  loadMonthlyReportMonth(): string | null;
  saveMonthlyReportMonth(month: string): void;
  /** プロセス横断の最終クレーム。UNIQUE 制約で最初の1件だけ成功。 */
  tryClaim(claimKey: string, claimedAt?: number): boolean;
};

export function createJsonScheduleMarkersRepository(
  db: SqliteExecutor = createSqliteExecutor(),
): ScheduleMarkersRepository {
  const morning = createJsonSingletonDocument<{ date: string | null }>("auto-morning-summary.json", {
    date: null,
  });
  const distillation = createJsonSingletonDocument<DistillationPersistedRaw>("auto-distillation.json", {});
  const grow = createJsonSingletonDocument<{ week: string | null }>("auto-grow.json", { week: null });
  const weekly = createJsonSingletonDocument<{ week: string | null }>("auto-weekly-report.json", {
    week: null,
  });
  const monthly = createJsonSingletonDocument<{ month: string | null }>("auto-monthly-report.json", {
    month: null,
  });

  return {
    loadMorningSummaryDate: () => morning.load().date,
    saveMorningSummaryDate: (date) => morning.save({ date }),
    loadDistillationRaw: () => distillation.load(),
    saveDistillation: (state) => distillation.save(state),
    loadGrowWeek: () => grow.load().week,
    saveGrowWeek: (week) => grow.save({ week }),
    loadWeeklyReportWeek: () => weekly.load().week,
    saveWeeklyReportWeek: (week) => weekly.save({ week }),
    loadMonthlyReportMonth: () => monthly.load().month,
    saveMonthlyReportMonth: (month) => monthly.save({ month }),
    tryClaim(claimKey: string, claimedAt = Date.now()): boolean {
      try {
        db.run("INSERT INTO auto_batch_claims (claim_key, claimed_at) VALUES (?, ?)", claimKey, claimedAt);
        return true;
      } catch {
        return false;
      }
    },
  };
}

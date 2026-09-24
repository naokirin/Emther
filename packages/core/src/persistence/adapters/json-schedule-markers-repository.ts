import { createJsonSingletonDocument } from "../json-document";

export type DistillationPersistedRaw = {
  week?: string | null;
  claimedWeekdays?: unknown;
};

/**
 * 自動バッチの二重起動ガード用 JSON マーカー群。
 * ドメイン（scheduled-tasks）はファイル名を知らない。
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
};

export function createJsonScheduleMarkersRepository(): ScheduleMarkersRepository {
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
  };
}

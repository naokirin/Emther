import { z } from "zod";
import { optionalBoolean, optionalFiniteNumber } from "./tolerant";

// ビジネスロジック付きフィールド（PERSON_n 照合・CLI 名一覧等）はルート側の専用関数のまま。
// ここは単純な number / boolean のみ（不正型 → 未指定）。

export const settingsRulesPatchSchema = z
  .object({
    teamWindowDays: optionalFiniteNumber,
    minEntriesForJudgement: optionalFiniteNumber,
    teamBadSentimentMax: optionalFiniteNumber,
    teamWarnSentimentMax: optionalFiniteNumber,
    coverageWindowDays: optionalFiniteNumber,
    coverageGoodRatio: optionalFiniteNumber,
    coverageWarnRatio: optionalFiniteNumber,
    agentStaleAfterSeconds: optionalFiniteNumber,
    agentKillAfterSeconds: optionalFiniteNumber,
    journalFactTtlDays: optionalFiniteNumber,
    autoSuggestionUpdateAnalysisEnabled: optionalBoolean,
    autoMorningSummaryEnabled: optionalBoolean,
    autoMorningSummaryHour: optionalFiniteNumber,
    autoJournalBatchEnabled: optionalBoolean,
    autoJournalBatchHour: optionalFiniteNumber, // 旧キー（互換）
    autoDistillationEnabled: optionalBoolean,
    autoDistillationWeekday: optionalFiniteNumber, // 旧キー（互換）
    autoDistillationHour: optionalFiniteNumber,
    autoGrowEnabled: optionalBoolean,
    autoGrowWeekday: optionalFiniteNumber,
    autoGrowHour: optionalFiniteNumber,
    autoWeeklyReportEnabled: optionalBoolean,
    autoWeeklyReportWeekday: optionalFiniteNumber,
    autoWeeklyReportHour: optionalFiniteNumber,
    autoMonthlyReportEnabled: optionalBoolean,
    autoMonthlyReportDay: optionalFiniteNumber,
    autoMonthlyReportHour: optionalFiniteNumber,
    teamParallelKickoffEnabled: optionalBoolean,
    localRerankEnabled: optionalBoolean,
  })
  .catch({});

export type SettingsRulesPatchBody = z.infer<typeof settingsRulesPatchSchema>;

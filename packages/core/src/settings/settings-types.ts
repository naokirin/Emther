import type { LocalChatModelPresetId } from "../local-chat-presets";
import type { CliName, ModelTier } from "../types";

// docs 3.1.1「判定閾値およびデータ欠如とみなす期間はCore Context（Rules_and_Constraints）
// 側で定義」に対応。Organization Context とは分離したアプリ設定。

export type RulesAndConstraints = {
  teamWindowDays: number;
  minEntriesForJudgement: number;
  teamBadSentimentMax: number;
  teamWarnSentimentMax: number;
  coverageWindowDays: number;
  coverageGoodRatio: number;
  coverageWarnRatio: number;
  agentStaleAfterSeconds: number;
  agentKillAfterSeconds: number;
  journalFactTtlDays: number;
  autoSuggestionUpdateAnalysisEnabled: boolean;
  autoMorningSummaryEnabled: boolean;
  autoMorningSummaryHour: number;
  autoJournalBatchEnabled: boolean;
  autoJournalBatchHours: number[];
  autoDistillationEnabled: boolean;
  autoDistillationWeekdays: number[];
  autoDistillationHour: number;
  autoGrowEnabled: boolean;
  autoGrowWeekday: number;
  autoGrowHour: number;
  autoWeeklyReportEnabled: boolean;
  autoWeeklyReportWeekday: number;
  autoWeeklyReportHour: number;
  autoMonthlyReportEnabled: boolean;
  autoMonthlyReportDay: number;
  autoMonthlyReportHour: number;
  maxParallelAgentRuns: number;
  perTurnBudgetUsd: number;
  teamParallelKickoffEnabled: boolean;
  decisionQueueLimit: number;
  observationQueueLimit: number;
  staleInterventionDays: number;
  agentModelTiers: Partial<Record<string, ModelTier>>;
  agentAgyModels: Partial<Record<string, string>>;
  agentCursorModels: Partial<Record<string, string>>;
  referenceLookupClaudeModel: ModelTier | "";
  referenceLookupCursorModel: string;
  cliOrder: CliName[];
  selfPersonId: string | null;
  localChatModelPreset: LocalChatModelPresetId;
  localRerankEnabled: boolean;
};

/** 旧キーを含む永続化ファイル形（アダプタが返す生データ）。 */
export type LegacyRulesFile = Partial<RulesAndConstraints> & {
  autoJournalBatchHour?: number;
  autoDistillationWeekday?: number;
  autoIssueUpdateAnalysisEnabled?: boolean;
};

export const DEFAULT_RULES: RulesAndConstraints = {
  teamWindowDays: 14,
  minEntriesForJudgement: 2,
  teamBadSentimentMax: -0.34,
  teamWarnSentimentMax: 0.2,
  coverageWindowDays: 30,
  coverageGoodRatio: 0.8,
  coverageWarnRatio: 0.4,
  agentStaleAfterSeconds: 120,
  agentKillAfterSeconds: 600,
  journalFactTtlDays: 90,
  autoSuggestionUpdateAnalysisEnabled: false,
  autoMorningSummaryEnabled: false,
  autoMorningSummaryHour: 7,
  autoJournalBatchEnabled: false,
  autoJournalBatchHours: [7],
  autoDistillationEnabled: false,
  autoDistillationWeekdays: [1],
  autoDistillationHour: 8,
  autoGrowEnabled: false,
  autoGrowWeekday: 1,
  autoGrowHour: 8,
  autoWeeklyReportEnabled: false,
  autoWeeklyReportWeekday: 1,
  autoWeeklyReportHour: 8,
  autoMonthlyReportEnabled: false,
  autoMonthlyReportDay: 1,
  autoMonthlyReportHour: 8,
  maxParallelAgentRuns: 2,
  perTurnBudgetUsd: 0.5,
  teamParallelKickoffEnabled: true,
  decisionQueueLimit: 3,
  observationQueueLimit: 3,
  staleInterventionDays: 14,
  agentModelTiers: {},
  agentAgyModels: {},
  agentCursorModels: {},
  referenceLookupClaudeModel: "",
  referenceLookupCursorModel: "",
  cliOrder: ["claude"],
  selfPersonId: null,
  localChatModelPreset: "1.2b-jp",
  localRerankEnabled: false,
};

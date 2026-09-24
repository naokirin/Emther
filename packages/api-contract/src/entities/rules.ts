import { z } from "zod";
import type { RulesAndConstraints } from "@emther/core/types";

const cliNameSchema = z.enum(["claude", "agy", "cursor"]);
const modelTierSchema = z.enum(["sonnet", "opus", "fable", "haiku"]);
const localChatModelPresetSchema = z.enum(["350m", "0.5b", "1.2b", "1.2b-jp", "1.5b"]);

// 必須スカラーは列挙。agentModelTiers 等の Partial マップは looseObject 側で許容。
export const rulesAndConstraintsSchema: z.ZodType<RulesAndConstraints> = z.looseObject({
  teamWindowDays: z.number(),
  minEntriesForJudgement: z.number(),
  teamBadSentimentMax: z.number(),
  teamWarnSentimentMax: z.number(),
  coverageWindowDays: z.number(),
  coverageGoodRatio: z.number(),
  coverageWarnRatio: z.number(),
  agentStaleAfterSeconds: z.number(),
  agentKillAfterSeconds: z.number(),
  journalFactTtlDays: z.number(),
  autoSuggestionUpdateAnalysisEnabled: z.boolean(),
  autoMorningSummaryEnabled: z.boolean(),
  autoMorningSummaryHour: z.number(),
  autoJournalBatchEnabled: z.boolean(),
  autoJournalBatchHours: z.array(z.number()),
  autoDistillationEnabled: z.boolean(),
  autoDistillationWeekdays: z.array(z.number()),
  autoDistillationHour: z.number(),
  autoGrowEnabled: z.boolean(),
  autoGrowWeekday: z.number(),
  autoGrowHour: z.number(),
  autoWeeklyReportEnabled: z.boolean(),
  autoWeeklyReportWeekday: z.number(),
  autoWeeklyReportHour: z.number(),
  autoMonthlyReportEnabled: z.boolean(),
  autoMonthlyReportDay: z.number(),
  autoMonthlyReportHour: z.number(),
  maxParallelAgentRuns: z.number(),
  perTurnBudgetUsd: z.number(),
  teamParallelKickoffEnabled: z.boolean(),
  decisionQueueLimit: z.number(),
  observationQueueLimit: z.number(),
  staleInterventionDays: z.number(),
  agentModelTiers: z.record(z.string(), z.unknown()),
  agentAgyModels: z.record(z.string(), z.unknown()),
  agentCursorModels: z.record(z.string(), z.unknown()),
  referenceLookupClaudeModel: z.union([modelTierSchema, z.literal("")]),
  referenceLookupCursorModel: z.string(),
  cliOrder: z.array(cliNameSchema),
  selfPersonId: z.string().nullable(),
  localChatModelPreset: localChatModelPresetSchema,
  localRerankEnabled: z.boolean(),
}) as z.ZodType<RulesAndConstraints>;

export type { RulesAndConstraints };

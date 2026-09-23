// lib/agent-runtime.ts のモジュール分割によるバレル。公開APIは分割前と完全に同じ名前・
// シグネチャを維持する（呼び出し側は "@core/agent-runtime" というパスaliasを使っており、
// ディレクトリ化してもこのパスは解決されるため変更不要）。

export type { SuggestedTheme } from "../theme-store";

export {
  extractLookup,
  LOOKUP_MAX_QUERIES,
  LOOKUP_MAX_ROUNDS,
  type LookupRequest,
  type LookupQuery,
} from "../agent-knowledge-tools";

export { EXEC_AGENT_NAME } from "./agent-catalog";

export type {
  AgentRun,
  AgentStatus,
  ConsultRequest,
  SuggestionCandidate,
  LogLine,
  PendingAgentStart,
  PendingAgentStartKind,
  PendingUnmaskedSend,
  PeriodReview,
  PeriodReviewBlindSpot,
  PeriodReviewComparisonItem,
  Proposal,
  ProposalRecommendation,
  RejectedAlternative,
  SuggestedSuggestionNote,
  SuggestionUpdate,
  YieldOption,
  YieldRequest,
} from "./types";
export { originLabel } from "./types";

export {
  draftKindLabel,
  isDraftAwaitingTriage,
  runFallbackTitle,
  runKindLabel,
  shouldOmitRunFromNextActions,
} from "./run-meta";

export {
  consultQuestionFor,
  ensureRequiredConsult,
  extractConsult,
  extractGrowSuggestions,
  extractSuggestionNotes,
  extractJournalAutoAnalysisText,
  extractPeriodReview,
  extractProposal,
  extractSuggestionUpdates,
  extractThemes,
  extractYield,
  listSuggestionCandidatesFromProposal,
  normalizeSuggestionCandidates,
} from "./extraction";

export {
  adoptSuggestedSuggestionNotesFromRun,
  adoptSuggestedThemesFromRun,
  adoptSuggestionUpdatesFromRun,
  checkStaleRuns,
  clearSuggestedSuggestionNotes,
  clearSuggestedThemes,
  clearSuggestedSuggestionUpdates,
  getRun,
  killLiveAgentProcesses,
  listRuns,
  listRunsPage,
  markRunReviewed,
  setRunArchived,
  setRunTriageStatus,
  toRunView,
} from "./store";

export {
  buildInterventionTypeGuidance,
  buildSuggestionContextBlock,
  buildOrgBackgroundBlock,
  buildGoalsContextBlock,
  buildOrgContextBlock,
  buildPolicyContextBlock,
  buildRelatedContextForRun,
  buildStrategyBlock,
  buildSystemPrompt,
  buildTeamCharterBlock,
  buildThemesContextBlock,
  relevantTeams,
  selectRelatedSpecialists,
} from "./context-blocks";

export {
  buildDistillationContextBlock,
  buildGrowContextBlock,
  buildJournalBatchContextBlock,
  buildMorningSummaryContextBlock,
  buildPeriodReviewContextBlock,
} from "./batch-context-blocks";

export {
  buildDistillationTask,
  buildJournalAnalysisTask,
  checkJournalBatchReview,
  checkMonthlyReport,
  checkMorningSummary,
  checkWeeklyDistillation,
  checkWeeklyGrow,
  checkWeeklyReport,
  clearAutoBatchClaimsForTest,
  DISTILLATION_TASK,
  GROWTH_TASK,
  SUGGESTION_UPDATE_DEBOUNCE_MS,
  isoWeekKey,
  JOURNAL_BATCH_TASK,
  listPendingAgentStarts,
  localDayBoundsMs,
  monthKey,
  MONTHLY_REPORT_TASK,
  MORNING_SUMMARY_TASK,
  reactToSuggestionUpdate,
  setSuggestionUpdateDebounceMsForTest,
  startDistillationAnalysis,
  startGrowAnalysis,
  startJournalAnalysis,
  startJournalBatchAnalysis,
  startPeriodReviewAnalysis,
  todayDateString,
  WEEKLY_REPORT_TASK,
} from "./scheduled-tasks";

export {
  buildSuggestionDraftTask,
  confirmPendingUnmaskedSend,
  decideRun,
  dismissPendingUnmaskedSend,
  listPendingUnmaskedSends,
  parkPendingUnmaskedSend,
  startRun,
} from "./run-actions";

export { runCloudChat } from "./cloud-chat";

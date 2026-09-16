// lib/agent-runtime.ts のモジュール分割によるバレル。公開APIは分割前と完全に同じ名前・
// シグネチャを維持する（呼び出し側は "@/lib/agent-runtime" というパスaliasを使っており、
// ディレクトリ化してもこのパスは解決されるため変更不要）。

export type { SuggestedTheme } from "@/lib/theme-store";

export {
  extractLookup,
  LOOKUP_MAX_QUERIES,
  LOOKUP_MAX_ROUNDS,
  type LookupRequest,
  type LookupQuery,
} from "@/lib/agent-knowledge-tools";

export { EXEC_AGENT_NAME } from "./agent-catalog";

export type {
  AgentRun,
  AgentStatus,
  ConsultRequest,
  IssueCandidate,
  LogLine,
  PendingAgentStart,
  PendingAgentStartKind,
  PendingUnmaskedSend,
  Proposal,
  ProposalRecommendation,
  RejectedAlternative,
  SuggestedIssueNote,
  SuggestedSubIssue,
  SuggestionUpdate,
  YieldOption,
  YieldRequest,
} from "./types";
export { originLabel } from "./types";

export {
  consultQuestionFor,
  ensureRequiredConsult,
  extractCharter,
  extractConsult,
  extractGrowSuggestions,
  extractIssueNotes,
  extractJournalAutoAnalysisText,
  extractProposal,
  extractSubIssues,
  extractSuggestionUpdates,
  extractThemes,
  extractYield,
  listIssueCandidatesFromProposal,
  normalizeIssueCandidates,
  normalizeSuggestedSubIssues,
} from "./extraction";

export {
  adoptSuggestedIssueNotesFromRun,
  adoptSuggestedThemesFromRun,
  adoptSuggestionUpdatesFromRun,
  checkStaleRuns,
  clearSuggestedCharter,
  clearSuggestedIssueNotes,
  clearSuggestedSubIssues,
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
  buildIssueContextBlock,
  buildObjectivesBlock,
  buildOrgBackgroundBlock,
  buildOrgContextBlock,
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
} from "./batch-context-blocks";

export {
  buildDistillationTask,
  buildJournalAnalysisTask,
  checkJournalBatchReview,
  checkMorningSummary,
  checkWeeklyDistillation,
  checkWeeklyGrow,
  clearAutoBatchClaimsForTest,
  DISTILLATION_TASK,
  GROWTH_TASK,
  ISSUE_UPDATE_DEBOUNCE_MS,
  isoWeekKey,
  JOURNAL_BATCH_TASK,
  listPendingAgentStarts,
  localDayBoundsMs,
  MORNING_SUMMARY_TASK,
  reactToIssueUpdate,
  setIssueUpdateDebounceMsForTest,
  startDistillationAnalysis,
  startGrowAnalysis,
  startJournalAnalysis,
  startJournalBatchAnalysis,
  todayDateString,
} from "./scheduled-tasks";

export {
  buildIssueDraftTask,
  confirmPendingUnmaskedSend,
  decideRun,
  dismissPendingUnmaskedSend,
  listPendingUnmaskedSends,
  parkPendingUnmaskedSend,
  startRun,
} from "./run-actions";

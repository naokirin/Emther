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
  SuggestedSubIssue,
  YieldOption,
  YieldRequest,
} from "./types";
export { originLabel } from "./types";

export {
  consultQuestionFor,
  ensureRequiredConsult,
  extractActionItems,
  extractCharter,
  extractConsult,
  extractJournalAutoAnalysisText,
  extractPriority,
  extractProposal,
  extractSubIssues,
  extractThemes,
  extractYield,
  listIssueCandidatesFromProposal,
  normalizeIssueCandidates,
  normalizeSuggestedSubIssues,
} from "./extraction";

export {
  adoptSuggestedThemesFromRun,
  checkStaleRuns,
  clearSuggestedActionItems,
  clearSuggestedCharter,
  clearSuggestedPriority,
  clearSuggestedSubIssues,
  clearSuggestedThemes,
  getRun,
  killLiveAgentProcesses,
  listRuns,
  listRunsPage,
  markRunReviewed,
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
  buildDistillationTask,
  buildJournalAnalysisTask,
  buildMorningSummaryContextBlock,
  checkMorningSummary,
  checkWeeklyDistillation,
  clearAutoBatchClaimsForTest,
  DISTILLATION_TASK,
  ISSUE_UPDATE_DEBOUNCE_MS,
  isoWeekKey,
  listPendingAgentStarts,
  localDayBoundsMs,
  matchesJournalAutoFilters,
  MORNING_SUMMARY_TASK,
  reactToIssueUpdate,
  setIssueUpdateDebounceMsForTest,
  startDistillationAnalysis,
  startJournalAnalysis,
  startJournalAutoAnalysis,
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

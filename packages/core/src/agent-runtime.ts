// Browser-safe entry for `@emther/core/agent-runtime`.
// Server orchestration（store / scheduled-tasks / CLI / context-blocks 等）は
// `@emther/core/agent-runtime/index` を使うこと。ここにフルバレルを re-export すると、
// web が値 import した瞬間に Vite が embeddings → transformers-file-cache → node:fs
// をクライアントバンドルへ引き込み、真っ黒画面になる。

export type {
  AgentRun,
  AgentStatus,
  ConsultRequest,
  SuggestionCandidate,
  ExplorationFinding,
  ExplorationKind,
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
} from "./agent-runtime/types";
export { EXPLORATION_KINDS, EXPLORATION_MAX_FINDINGS, originLabel } from "./agent-runtime/types";

export {
  draftKindLabel,
  isDraftAwaitingTriage,
  runFallbackTitle,
  runKindLabel,
  shouldOmitRunFromNextActions,
} from "./agent-runtime/run-meta";

export type { SuggestedTheme } from "./theme-store";

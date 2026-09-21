// docs/2nd_pivot_version.md Phase 7。issue-store 互換レイヤー用のレガシー型。
// Suggestion 移行完了後に削除する。

import type { SuggestionReviewStatus } from "./types";

export type ActionItem = {
  id: string;
  text: string;
  done: boolean;
};

export type IssueStatus = "not_started" | "in_progress" | "blocked" | "done";
export type IssuePriority = "focus" | "normal" | "parked";

export type IssueLogEntry = {
  id: string;
  text: string;
  createdAt: number;
};

export type IssueTriageSource = "ai" | "heuristic";
export type IssueTriageScores = {
  costOfDelay: number;
  effort: number;
  blastRadius: number;
  confidence: number;
  score: number;
  suggestedPriority: IssuePriority;
  scoredAt: number;
  source?: IssueTriageSource;
};

export type IssueCharter = {
  why: string;
  what: string;
  how: string;
};

export type Issue = {
  id: string;
  title: string;
  agentRunId?: string;
  sourceRunId?: string;
  sourceJournalId?: string;
  charter: IssueCharter;
  actionItems: ActionItem[];
  logEntries: IssueLogEntry[];
  parentId?: string;
  status: IssueStatus;
  // docs/memo.md「つながりを見るで提案の横に謎の『進行中』が出る」対応。statusは旧Issue
  // ワークフロー互換のため in_progress/blocked/done の3値しか取らず、未確認(unreviewed)の
  // 提案も一律「進行中」に見えてしまう。EMが実際に確認した状態（確認状態）を出したい画面
  // 向けに、Suggestion.reviewStatusをそのまま持たせておく。
  reviewStatus: SuggestionReviewStatus;
  // ユーザー要望「後回しにする場合でも『いつまでには確認したい』という期日を入力したい」
  // 対応。Suggestion.reviewDueAtをそのまま持たせ、朝キューでの期日超過判定に使う。
  reviewDueAt?: number;
  priority: IssuePriority;
  focusOrder?: number;
  archived: boolean;
  archivedAt?: number;
  doneAt?: number;
  tags: string[];
  themeId?: string;
  teamId?: string;
  triage?: IssueTriageScores;
  embedding?: number[];
  createdAt: number;
  updatedAt: number;
};

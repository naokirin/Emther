// docs/2nd_pivot_version.md Phase 7。issue-store 互換レイヤー用のレガシー型。
// Suggestion 移行完了後に削除する。

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
  priority: IssuePriority;
  focusOrder?: number;
  archived: boolean;
  archivedAt?: number;
  doneAt?: number;
  tags: string[];
  keyResultId?: string;
  themeId?: string;
  teamId?: string;
  triage?: IssueTriageScores;
  embedding?: number[];
  createdAt: number;
  updatedAt: number;
};

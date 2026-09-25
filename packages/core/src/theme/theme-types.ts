export type ThemeStatus = "candidate" | "adopted" | "dismissed";

export type OrgTheme = {
  id: string;
  title: string;
  summary: string;
  rationale: string;
  facts: string[];
  rootCause?: string;
  suggestedDirection?: string;
  evidenceJournalIds: string[];
  evidenceSuggestionIds: string[];
  goalIds?: string[];
  status: ThemeStatus;
  sourceRunId?: string;
  teamId?: string;
  supersedes?: string;
  /** 一覧の手動並び順（昇順）。 */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  adoptedAt?: number;
};

export type SuggestedTheme = {
  title: string;
  summary: string;
  rationale: string;
  facts: string[];
  rootCause?: string;
  suggestedDirection?: string;
  evidenceJournalIds?: string[];
  evidenceSuggestionIds?: string[];
  goalIds?: string[];
};

/** 旧 themes.json 互換（読み込み時のみ）。 */
export type LegacyOrgTheme = OrgTheme & { embedding?: number[]; evidenceIssueIds?: string[] };

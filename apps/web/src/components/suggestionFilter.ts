import type { ConfirmPriority, SuggestionReviewStatus } from "@emther/core/types";

export type SuggestionSortKey = "due" | "priority" | "updated";

export type SuggestionFilterState = {
  query: string;
  sort: SuggestionSortKey;
  statusFilter: Set<SuggestionReviewStatus>;
  priorityFilter: Set<ConfirmPriority>;
  showDone: boolean;
  showArchived: boolean;
};

export const DEFAULT_SUGGESTION_STATUS_FILTER: SuggestionReviewStatus[] = [
  "unreviewed",
  "in_review",
  "deferred",
];

export const SUGGESTION_SORT_OPTIONS: { value: SuggestionSortKey; label: string }[] = [
  { value: "due", label: "期日が近い順" },
  { value: "priority", label: "確認優先度順" },
  { value: "updated", label: "最終更新順" },
];

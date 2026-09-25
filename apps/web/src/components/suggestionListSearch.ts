// 提案一覧のフィルタ／ソート／テーマを URL search に載せる。
// 方針: フィルタ・ソートは必須、テーマ（タブ相当）はあると良い、行選択は載せない。
import { z } from "zod";
import {
  CONFIRM_PRIORITIES,
  SUGGESTION_REVIEW_STATUSES,
  type SuggestionReviewStatus,
} from "@emther/core/types";
import { SUGGESTION_THEME_ALL, SUGGESTION_THEME_UNLINKED } from "./SuggestionThemeSwitcher";
import {
  DEFAULT_SUGGESTION_STATUS_FILTER,
  type SuggestionFilterState,
  type SuggestionSortKey,
} from "./suggestionFilter";

const SORT_VALUES = ["due", "priority", "updated"] as const satisfies readonly SuggestionSortKey[];
const STATUS_ALL = "all";
const THEME_UNLINKED_PARAM = "unlinked";

export const suggestionListSearchSchema = z.object({
  q: z.string().optional(),
  sort: z.enum(SORT_VALUES).optional().catch(undefined),
  status: z.string().optional(),
  priority: z.string().optional(),
  done: z.enum(["1"]).optional().catch(undefined),
  archived: z.enum(["1"]).optional().catch(undefined),
  theme: z.string().optional(),
});

/** ルート validateSearch 用: 一覧フィルタ + サイドピーク */
export const suggestionsRouteSearchSchema = suggestionListSearchSchema.merge(
  z.object({
    suggestion: z.string().optional(),
  }),
);

export type SuggestionListSearchParams = z.infer<typeof suggestionListSearchSchema>;

export type SuggestionListSearchState = {
  themeKey: string;
  filters: SuggestionFilterState;
};

export function defaultSuggestionListSearchState(): SuggestionListSearchState {
  return {
    themeKey: SUGGESTION_THEME_ALL,
    filters: {
      query: "",
      sort: "due",
      statusFilter: new Set(DEFAULT_SUGGESTION_STATUS_FILTER),
      priorityFilter: new Set(),
      showDone: false,
      showArchived: false,
    },
  };
}

function parseCsvSet<T extends string>(raw: string | undefined, allowed: readonly T[]): Set<T> {
  if (!raw) return new Set();
  const allowedSet = new Set<string>(allowed);
  const next = new Set<T>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (allowedSet.has(trimmed)) next.add(trimmed as T);
  }
  return next;
}

function formatCsvSet<T extends string>(set: Set<T>, order: readonly T[]): string | undefined {
  if (set.size === 0) return undefined;
  const values = order.filter((v) => set.has(v));
  return values.length > 0 ? values.join(",") : undefined;
}

function sameStatusDefault(set: Set<SuggestionReviewStatus>): boolean {
  if (set.size !== DEFAULT_SUGGESTION_STATUS_FILTER.length) return false;
  return DEFAULT_SUGGESTION_STATUS_FILTER.every((s) => set.has(s));
}

export function decodeSuggestionListSearch(params: SuggestionListSearchParams): SuggestionListSearchState {
  const defaults = defaultSuggestionListSearchState();
  let statusFilter = defaults.filters.statusFilter;
  if (params.status === STATUS_ALL) {
    statusFilter = new Set();
  } else if (params.status) {
    statusFilter = parseCsvSet(params.status, SUGGESTION_REVIEW_STATUSES);
  }

  let themeKey = SUGGESTION_THEME_ALL;
  if (params.theme === THEME_UNLINKED_PARAM) themeKey = SUGGESTION_THEME_UNLINKED;
  else if (params.theme) themeKey = params.theme;

  return {
    themeKey,
    filters: {
      query: params.q ?? "",
      sort: params.sort ?? "due",
      statusFilter,
      priorityFilter: parseCsvSet(params.priority, CONFIRM_PRIORITIES),
      showDone: params.done === "1",
      showArchived: params.archived === "1",
    },
  };
}

/** 現在の一覧状態を URL 更新用の差分に変換する（デフォルト値はキー削除）。 */
export function encodeSuggestionListSearch(
  state: SuggestionListSearchState,
): Partial<SuggestionListSearchParams> {
  const { themeKey, filters } = state;
  let status: string | undefined;
  if (filters.statusFilter.size === 0) status = STATUS_ALL;
  else if (!sameStatusDefault(filters.statusFilter)) {
    status = formatCsvSet(filters.statusFilter, SUGGESTION_REVIEW_STATUSES);
  }

  let theme: string | undefined;
  if (themeKey === SUGGESTION_THEME_UNLINKED) theme = THEME_UNLINKED_PARAM;
  else if (themeKey !== SUGGESTION_THEME_ALL) theme = themeKey;

  return {
    q: filters.query || undefined,
    sort: filters.sort === "due" ? undefined : filters.sort,
    status,
    priority: formatCsvSet(filters.priorityFilter, CONFIRM_PRIORITIES),
    done: filters.showDone ? "1" : undefined,
    archived: filters.showArchived ? "1" : undefined,
    theme,
  };
}

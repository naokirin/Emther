// Journal 一覧のフィルタを URL search に載せる。
// 方針: フィルタは必須。focus/dump/prefill は deep link 用で別キー（共存する）。
// person= は人物詳細からのリンクと同一キー。
import { z } from "zod";
import type { JournalEntry } from "@emther/core/types";
import type { JournalFilterState } from "./JournalFilterBar";

const PERIOD_VALUES = ["all", "7", "30", "90"] as const;
const URGENCY_VALUES = ["low", "mid", "high"] as const;
const SENTIMENT_VALUES = ["positive", "neutral", "negative"] as const;

export const journalListSearchSchema = z.object({
  q: z.string().optional(),
  period: z.enum(PERIOD_VALUES).optional().catch(undefined),
  person: z.string().optional(),
  tag: z.string().optional(),
  urgency: z.enum(URGENCY_VALUES).optional().catch(undefined),
  sentiment: z.enum(SENTIMENT_VALUES).optional().catch(undefined),
  excludeResolved: z.enum(["1"]).optional().catch(undefined),
  archived: z.enum(["1"]).optional().catch(undefined),
  quarantined: z.enum(["1"]).optional().catch(undefined),
  sensitive: z.enum(["1"]).optional().catch(undefined),
});

export type JournalListSearchParams = z.infer<typeof journalListSearchSchema>;

export const EMPTY_JOURNAL_LIST_FILTERS: Omit<JournalFilterState, "query"> = {
  periodDays: "all",
  personFilter: "",
  tagFilter: "",
  urgencyFilter: "",
  sentimentFilter: "",
  excludeResolved: false,
  includeArchived: false,
  quarantinedOnly: false,
  includeSensitive: false,
};

export function decodeJournalListSearch(params: JournalListSearchParams): JournalFilterState {
  return {
    query: params.q ?? "",
    periodDays: params.period ?? "all",
    personFilter: params.person ?? "",
    tagFilter: params.tag ?? "",
    urgencyFilter: (params.urgency ?? "") as JournalEntry["urgency"] | "",
    sentimentFilter: (params.sentiment ?? "") as JournalEntry["sentiment"] | "",
    excludeResolved: params.excludeResolved === "1",
    includeArchived: params.archived === "1",
    quarantinedOnly: params.quarantined === "1",
    includeSensitive: params.sensitive === "1",
  };
}

/** 現在のフィルタを URL 更新用の差分に変換する（デフォルト値はキー削除）。 */
export function encodeJournalListSearch(filters: JournalFilterState): Partial<JournalListSearchParams> {
  return {
    q: filters.query || undefined,
    period: filters.periodDays === "all" ? undefined : (filters.periodDays as JournalListSearchParams["period"]),
    person: filters.personFilter || undefined,
    tag: filters.tagFilter || undefined,
    urgency: (filters.urgencyFilter || undefined) as JournalListSearchParams["urgency"] | undefined,
    sentiment: (filters.sentimentFilter || undefined) as JournalListSearchParams["sentiment"] | undefined,
    excludeResolved: filters.excludeResolved ? "1" : undefined,
    archived: filters.includeArchived ? "1" : undefined,
    quarantined: filters.quarantinedOnly ? "1" : undefined,
    sensitive: filters.includeSensitive ? "1" : undefined,
  };
}

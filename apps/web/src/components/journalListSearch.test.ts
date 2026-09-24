import { describe, expect, it } from "vitest";
import {
  decodeJournalListSearch,
  EMPTY_JOURNAL_LIST_FILTERS,
  encodeJournalListSearch,
} from "./journalListSearch";

describe("journalListSearch", () => {
  it("空の search は空フィルタを返す", () => {
    expect(decodeJournalListSearch({})).toEqual({
      query: "",
      ...EMPTY_JOURNAL_LIST_FILTERS,
    });
  });

  it("person= を含むフィルタを往復できる（人物詳細リンク互換）", () => {
    const encoded = encodeJournalListSearch({
      query: "1on1",
      periodDays: "30",
      personFilter: "Aさん",
      tagFilter: "振り返り",
      urgencyFilter: "high",
      sentimentFilter: "negative",
      excludeResolved: true,
      includeArchived: true,
      quarantinedOnly: false,
      includeSensitive: true,
    });
    expect(encoded).toEqual({
      q: "1on1",
      period: "30",
      person: "Aさん",
      tag: "振り返り",
      urgency: "high",
      sentiment: "negative",
      excludeResolved: "1",
      archived: "1",
      quarantined: undefined,
      sensitive: "1",
    });
    expect(decodeJournalListSearch(encoded)).toEqual({
      query: "1on1",
      periodDays: "30",
      personFilter: "Aさん",
      tagFilter: "振り返り",
      urgencyFilter: "high",
      sentimentFilter: "negative",
      excludeResolved: true,
      includeArchived: true,
      quarantinedOnly: false,
      includeSensitive: true,
    });
  });
});

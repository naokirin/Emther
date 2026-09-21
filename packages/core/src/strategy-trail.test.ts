import { describe, expect, it } from "vitest";
import { buildSuggestionStrategyTrail, buildJournalStrategyTrail } from "./strategy-trail";
import type { Suggestion, JournalEntry } from "./types";

describe("buildSuggestionStrategyTrail", () => {
  it("提案ノードのみを返す", () => {
    const suggestion = { id: "suggestion-1", title: "Bチーム1on1不足" };
    expect(buildSuggestionStrategyTrail(suggestion)).toEqual([{ kind: "suggestion", id: "suggestion-1", label: "Bチーム1on1不足" }]);
  });
});

describe("buildJournalStrategyTrail", () => {
  const suggestions: Pick<Suggestion, "id" | "title">[] = [{ id: "suggestion-1", title: "Bチーム1on1不足" }];

  it("resolvedSuggestionId未設定なら空配列（戦略へ未接続）", () => {
    const entry = { id: "journal-1", resolvedSuggestionId: undefined, resolvedSuggestionTitle: undefined };
    expect(buildJournalStrategyTrail(entry, suggestions)).toEqual([]);
  });

  it("resolvedSuggestionIdから提案 › Journalまで組み立てる", () => {
    const entry = { id: "journal-1", resolvedSuggestionId: "suggestion-1", resolvedSuggestionTitle: "Bチーム1on1不足" };
    expect(buildJournalStrategyTrail(entry, suggestions)).toEqual([
      { kind: "suggestion", id: "suggestion-1", label: "Bチーム1on1不足" },
      { kind: "journal", id: "journal-1", label: "このJournal" },
    ]);
  });

  it("suggestions配列に提案が見つからなくてもresolvedSuggestionTitleで提案ノードだけは出す", () => {
    const entry: Pick<JournalEntry, "id" | "resolvedSuggestionId" | "resolvedSuggestionTitle"> = {
      id: "journal-1",
      resolvedSuggestionId: "suggestion-unknown",
      resolvedSuggestionTitle: "消えた提案",
    };
    expect(buildJournalStrategyTrail(entry, suggestions)).toEqual([
      { kind: "suggestion", id: "suggestion-unknown", label: "消えた提案" },
      { kind: "journal", id: "journal-1", label: "このJournal" },
    ]);
  });
});

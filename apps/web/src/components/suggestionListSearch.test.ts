import { describe, expect, it } from "vitest";
import {
  decodeSuggestionListSearch,
  defaultSuggestionListSearchState,
  encodeSuggestionListSearch,
} from "./suggestionListSearch";
import { SUGGESTION_THEME_ALL, SUGGESTION_THEME_UNLINKED } from "./SuggestionThemeSwitcher";
import { DEFAULT_SUGGESTION_STATUS_FILTER } from "./suggestionFilter";

describe("suggestionListSearch", () => {
  it("空の search はデフォルトの確認状態フィルタとソートを返す", () => {
    const state = decodeSuggestionListSearch({});
    expect(state.themeKey).toBe(SUGGESTION_THEME_ALL);
    expect(state.filters.sort).toBe("due");
    expect(state.filters.showDone).toBe(false);
    expect([...state.filters.statusFilter]).toEqual(DEFAULT_SUGGESTION_STATUS_FILTER);
  });

  it("デフォルト状態の encode はキーをすべて省略する", () => {
    expect(encodeSuggestionListSearch(defaultSuggestionListSearchState())).toEqual({
      q: undefined,
      sort: undefined,
      status: undefined,
      priority: undefined,
      done: undefined,
      archived: undefined,
      theme: undefined,
    });
  });

  it("status=all は確認状態フィルタなし（すべて表示）", () => {
    const state = decodeSuggestionListSearch({ status: "all", done: "1" });
    expect(state.filters.statusFilter.size).toBe(0);
    expect(state.filters.showDone).toBe(true);
    expect(encodeSuggestionListSearch(state)).toMatchObject({ status: "all", done: "1" });
  });

  it("theme=unlinked と sort/q を往復できる", () => {
    const encoded = encodeSuggestionListSearch({
      themeKey: SUGGESTION_THEME_UNLINKED,
      filters: {
        query: "セキュリティ",
        sort: "updated",
        statusFilter: new Set(["unreviewed"]),
        priorityFilter: new Set(["focus"]),
        showDone: false,
        showArchived: true,
      },
    });
    expect(encoded).toEqual({
      q: "セキュリティ",
      sort: "updated",
      status: "unreviewed",
      priority: "focus",
      done: undefined,
      archived: "1",
      theme: "unlinked",
    });
    const decoded = decodeSuggestionListSearch(encoded);
    expect(decoded.themeKey).toBe(SUGGESTION_THEME_UNLINKED);
    expect(decoded.filters.query).toBe("セキュリティ");
    expect(decoded.filters.sort).toBe("updated");
    expect([...decoded.filters.statusFilter]).toEqual(["unreviewed"]);
    expect([...decoded.filters.priorityFilter]).toEqual(["focus"]);
    expect(decoded.filters.showArchived).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

vi.mock("@emther/core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
}));

vi.mock("@emther/core/cloud-chat", () => ({
  runCloudChat: vi.fn(async () => {
    throw new Error("cloud unavailable in test");
  }),
}));

vi.mock("@emther/core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => {
    const start = text.indexOf("{");
    if (start === -1) return undefined;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return undefined;
  },
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("POST /api/suggestions/link/suggest", () => {
  it("戦略未接続の提案へテーマ案を返す", async () => {
    const themeStore = await import("@emther/core/theme-store");
    const suggestionStore = await import("@emther/core/suggestion-store");

    const theme = await themeStore.createThemeCandidate({
      title: "オンボーディング改善",
      summary: "新規参加の立ち上がりを速くする",
      rationale: "理由",
      facts: ["立ち上がりが遅い"],
    });
    await themeStore.adoptTheme(theme.id);

    const suggestion = await suggestionStore.createSuggestion("オンボーディングの詰まり解消", {
      detail: { conclusion: "新規参加の立ち上がりを速くする", facts: ["詰まりを特定する"], logic: "ヒアリング" },
    });

    const { suggestionsLinkSuggestRoute } = await import("./suggestions-link-suggest");
    const res = await suggestionsLinkSuggestRoute.request("/", post({}));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetCount).toBe(1);
    expect(data.suggestions.length).toBeGreaterThan(0);
    expect(data.suggestions[0].suggestionId).toBe(suggestion.id);
    expect(data.suggestions[0].themeId).toBe(theme.id);
  });

  it("suggestionIds で単件に絞れる", async () => {
    const themeStore = await import("@emther/core/theme-store");
    const suggestionStore = await import("@emther/core/suggestion-store");

    const theme = await themeStore.createThemeCandidate({ title: "品質", summary: "品質を上げる", rationale: "理由", facts: [] });
    await themeStore.adoptTheme(theme.id);

    const a = await suggestionStore.createSuggestion("品質の課題A", {
      detail: { conclusion: "品質", facts: ["A"], logic: "調査" },
    });
    await suggestionStore.createSuggestion("品質の課題B", {
      detail: { conclusion: "品質", facts: ["B"], logic: "調査" },
    });

    const { suggestionsLinkSuggestRoute } = await import("./suggestions-link-suggest");
    const res = await suggestionsLinkSuggestRoute.request("/", post({ suggestionIds: [a.id] }));
    const data = await res.json();
    expect(data.targetCount).toBe(1);
    expect(data.suggestions.every((s: { suggestionId: string }) => s.suggestionId === a.id)).toBe(true);
  });
});

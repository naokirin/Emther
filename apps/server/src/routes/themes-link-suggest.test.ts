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

describe("POST /api/themes/link/suggest", () => {
  it("OKR未リンクの採用テーマへヒューリスティックでリンク案を返す", async () => {
    const org = await import("@emther/core/org-context-store/index");
    const themeStore = await import("@emther/core/theme-store");

    const objective = await org.addObjective("信頼性を上げる");
    await org.addKeyResult(objective.id, "重大インシデントを半減する");

    const theme = await themeStore.createThemeCandidate({
      title: "信頼性の立て直し",
      summary: "インシデント増加に対し信頼性を上げる焦点",
      rationale: "観測から",
      facts: ["重大インシデントが増えた"],
    });
    await themeStore.adoptTheme(theme.id);

    const { themesLinkSuggestRoute } = await import("./themes-link-suggest");
    const res = await themesLinkSuggestRoute.request("/", post({}));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetCount).toBe(1);
    expect(data.source).toBe("heuristic");
    expect(typeof data.fallbackReason).toBe("string");
    expect(data.fallbackReason).toMatch(/^cloud_error:/);
    expect(data.suggestions.length).toBeGreaterThan(0);
    expect(data.suggestions[0].themeId).toBe(theme.id);
    expect(data.suggestions[0].objectiveIds.length + data.suggestions[0].keyResultIds.length).toBeGreaterThan(0);
  });

  it("既にリンク済みのテーマは対象外", async () => {
    const org = await import("@emther/core/org-context-store/index");
    const themeStore = await import("@emther/core/theme-store");

    const objective = await org.addObjective("体験改善");
    const theme = await themeStore.createThemeCandidate({
      title: "体験",
      summary: "体験",
      rationale: "理由",
      facts: [],
      objectiveIds: [objective.id],
    });
    await themeStore.adoptTheme(theme.id);

    const { themesLinkSuggestRoute } = await import("./themes-link-suggest");
    const res = await themesLinkSuggestRoute.request("/", post({}));
    const data = await res.json();
    expect(data.targetCount).toBe(0);
    expect(data.suggestions).toEqual([]);
  });
});

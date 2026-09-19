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

describe("POST /api/issues/link/suggest", () => {
  it("戦略未接続の親 Issue へテーマ案を返す", async () => {
    const themeStore = await import("@emther/core/theme-store");
    const issueStore = await import("@emther/core/issue-store");

    const theme = await themeStore.createThemeCandidate({
      title: "オンボーディング改善",
      summary: "新規参加の立ち上がりを速くする",
      rationale: "理由",
      facts: ["立ち上がりが遅い"],
    });
    await themeStore.adoptTheme(theme.id);

    const issue = await issueStore.createIssue("オンボーディングの詰まり解消", undefined, {
      why: "新規参加の立ち上がりを速くする",
      what: "詰まりを特定する",
      how: "ヒアリング",
    });

    const { issuesLinkSuggestRoute } = await import("./issues-link-suggest");
    const res = await issuesLinkSuggestRoute.request("/", post({}));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetCount).toBe(1);
    expect(data.suggestions.length).toBeGreaterThan(0);
    expect(data.suggestions[0].issueId).toBe(issue.id);
    expect(data.suggestions[0].themeId).toBe(theme.id);
  });

  it("issueIds で単件に絞れる", async () => {
    const themeStore = await import("@emther/core/theme-store");
    const issueStore = await import("@emther/core/issue-store");

    const theme = await themeStore.createThemeCandidate({ title: "品質", summary: "品質を上げる", rationale: "理由", facts: [] });
    await themeStore.adoptTheme(theme.id);

    const a = await issueStore.createIssue("品質の課題A", undefined, { why: "品質", what: "A", how: "調査" });
    await issueStore.createIssue("品質の課題B", undefined, { why: "品質", what: "B", how: "調査" });

    const { issuesLinkSuggestRoute } = await import("./issues-link-suggest");
    const res = await issuesLinkSuggestRoute.request("/", post({ issueIds: [a.id] }));
    const data = await res.json();
    expect(data.targetCount).toBe(1);
    expect(data.suggestions.every((s: { issueId: string }) => s.issueId === a.id)).toBe(true);
  });
});

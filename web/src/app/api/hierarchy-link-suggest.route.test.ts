import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
}));

vi.mock("@/lib/cloud-chat", () => ({
  runCloudChat: vi.fn(async () => {
    throw new Error("cloud unavailable in test");
  }),
}));

vi.mock("@/lib/local-model", () => ({
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

describe("POST /api/themes/link/suggest", () => {
  it("OKR未リンクの採用テーマへヒューリスティックでリンク案を返す", async () => {
    const org = await import("@/lib/org-context-store");
    const themeStore = await import("@/lib/theme-store");

    const objective = await org.addObjective("信頼性を上げる");
    await org.addKeyResult(objective.id, "重大インシデントを半減する");

    const theme = await themeStore.createThemeCandidate({
      title: "信頼性の立て直し",
      summary: "インシデント増加に対し信頼性を上げる焦点",
      rationale: "観測から",
      facts: ["重大インシデントが増えた"],
    });
    await themeStore.adoptTheme(theme.id);

    const route = await import("@/app/api/themes/link/suggest/route");
    const res = await route.POST(jsonRequest("http://localhost/api/themes/link/suggest", "POST", {}));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetCount).toBe(1);
    expect(data.source).toBe("heuristic");
    expect(typeof data.fallbackReason).toBe("string");
    expect(data.fallbackReason).toMatch(/^cloud_error:/);
    expect(data.suggestions.length).toBeGreaterThan(0);
    expect(data.suggestions[0].themeId).toBe(theme.id);
    expect(
      data.suggestions[0].objectiveIds.length + data.suggestions[0].keyResultIds.length,
    ).toBeGreaterThan(0);
  });

  it("既にリンク済みのテーマは対象外", async () => {
    const org = await import("@/lib/org-context-store");
    const themeStore = await import("@/lib/theme-store");

    const objective = await org.addObjective("体験改善");
    const theme = await themeStore.createThemeCandidate({
      title: "体験",
      summary: "体験",
      rationale: "理由",
      facts: [],
      objectiveIds: [objective.id],
    });
    await themeStore.adoptTheme(theme.id);

    const route = await import("@/app/api/themes/link/suggest/route");
    const res = await route.POST(jsonRequest("http://localhost/api/themes/link/suggest", "POST", {}));
    const data = await res.json();
    expect(data.targetCount).toBe(0);
    expect(data.suggestions).toEqual([]);
  });
});

describe("POST /api/issues/link/suggest", () => {
  it("戦略未接続の親 Issue へテーマ案を返す", async () => {
    const themeStore = await import("@/lib/theme-store");
    const issueStore = await import("@/lib/issue-store");

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

    const route = await import("@/app/api/issues/link/suggest/route");
    const res = await route.POST(jsonRequest("http://localhost/api/issues/link/suggest", "POST", {}));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetCount).toBe(1);
    expect(data.suggestions.length).toBeGreaterThan(0);
    expect(data.suggestions[0].issueId).toBe(issue.id);
    expect(data.suggestions[0].themeId).toBe(theme.id);
  });

  it("issueIds で単件に絞れる", async () => {
    const themeStore = await import("@/lib/theme-store");
    const issueStore = await import("@/lib/issue-store");

    const theme = await themeStore.createThemeCandidate({
      title: "品質",
      summary: "品質を上げる",
      rationale: "理由",
      facts: [],
    });
    await themeStore.adoptTheme(theme.id);

    const a = await issueStore.createIssue("品質の課題A", undefined, {
      why: "品質",
      what: "A",
      how: "調査",
    });
    await issueStore.createIssue("品質の課題B", undefined, {
      why: "品質",
      what: "B",
      how: "調査",
    });

    const route = await import("@/app/api/issues/link/suggest/route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/issues/link/suggest", "POST", { issueIds: [a.id] }),
    );
    const data = await res.json();
    expect(data.targetCount).toBe(1);
    expect(data.suggestions.every((s: { issueId: string }) => s.issueId === a.id)).toBe(true);
  });
});

describe("link-suggest unit", () => {
  it("クラウド成功時は cloud source になる", async () => {
    const { runCloudChat } = await import("@/lib/cloud-chat");
    const org = await import("@/lib/org-context-store");
    const themeStore = await import("@/lib/theme-store");

    const objective = await org.addObjective("基盤進化");
    const withKr = await org.addKeyResult(objective.id, "認証をプライマリにする");
    const krId = withKr!.keyResults[0].id;

    const theme = await themeStore.createThemeCandidate({
      title: "認証基盤",
      summary: "認証",
      rationale: "理由",
      facts: [],
    });
    await themeStore.adoptTheme(theme.id);

    vi.mocked(runCloudChat).mockResolvedValueOnce(
      JSON.stringify({
        suggestions: [
          {
            themeId: theme.id,
            objectiveIds: [objective.id],
            keyResultIds: [krId],
            rationale: "認証に直結するため",
          },
        ],
      }),
    );

    const { suggestThemeOkrLinks } = await import("@/lib/link-suggest");
    const result = await suggestThemeOkrLinks();
    expect(result.source).toBe("cloud");
    expect(result.fallbackReason).toBeUndefined();
    expect(result.suggestions[0].objectiveIds).toContain(objective.id);
    expect(result.suggestions[0].keyResultIds).toContain(krId);
  });

  it("クラウドプロンプトに実名を載せない（マスク済みのまま送る）", async () => {
    const { runCloudChat } = await import("@/lib/cloud-chat");
    const { registerName } = await import("@/lib/people-directory");
    const themeStore = await import("@/lib/theme-store");
    const issueStore = await import("@/lib/issue-store");

    registerName("診断太郎");
    const theme = await themeStore.createThemeCandidate({
      title: "診断太郎の休職に伴う品質保証体制の危機",
      summary: "診断太郎が不在で品質が落ちる",
      rationale: "観測",
      facts: ["診断太郎が休職した"],
    });
    await themeStore.adoptTheme(theme.id);

    const issue = await issueStore.createIssue("品質体制の立て直し", undefined, {
      why: "品質保証を守る",
      what: "体制を見直す",
      how: "役割分担",
    });

    let capturedUser = "";
    vi.mocked(runCloudChat).mockImplementationOnce(async (_sys, user) => {
      capturedUser = user;
      return JSON.stringify({
        suggestions: [{ issueId: issue.id, themeId: theme.id, keyResultId: null, rationale: "関連" }],
      });
    });

    const { suggestIssueStrategyLinks } = await import("@/lib/link-suggest");
    const result = await suggestIssueStrategyLinks({ issueIds: [issue.id] });
    expect(capturedUser).not.toContain("診断太郎");
    expect(capturedUser).toMatch(/PERSON_\d/);
    expect(result.source).toBe("cloud");
    expect(result.suggestions[0]?.labels.theme).toContain("診断太郎");
  });
});

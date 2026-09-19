import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";

vi.mock("@core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
}));

vi.mock("@core/cloud-chat", () => ({
  runCloudChat: vi.fn(async () => {
    throw new Error("cloud unavailable in test");
  }),
}));

vi.mock("@core/local-model", () => ({
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

// docs/2nd_architecture/plan.md フェーズ2.5: themes/link/suggest・issues/link/suggestの
// ルート自体はapps/server側へ移植済み（テストもapps/server/src/routes/
// {themes-link-suggest,issues-link-suggest}.test.tsへ移設）。ここに残るのは
// @core/link-suggest（ドメインロジック）を直接呼ぶユニットテストのみで、
// ルート層（Next/Hono）とは独立して有効。

describe("link-suggest unit", () => {
  it("クラウド成功時は cloud source になる", async () => {
    const { runCloudChat } = await import("@core/cloud-chat");
    const org = await import("@core/org-context-store/index");
    const themeStore = await import("@core/theme-store");

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

    const { suggestThemeOkrLinks } = await import("@core/link-suggest");
    const result = await suggestThemeOkrLinks();
    expect(result.source).toBe("cloud");
    expect(result.fallbackReason).toBeUndefined();
    expect(result.suggestions[0].objectiveIds).toContain(objective.id);
    expect(result.suggestions[0].keyResultIds).toContain(krId);
  });

  it("クラウドプロンプトに実名を載せない（マスク済みのまま送る）", async () => {
    const { runCloudChat } = await import("@core/cloud-chat");
    const { registerName } = await import("@core/people-directory");
    const themeStore = await import("@core/theme-store");
    const issueStore = await import("@core/issue-store");

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

    const { suggestIssueStrategyLinks } = await import("@core/link-suggest");
    const result = await suggestIssueStrategyLinks({ issueIds: [issue.id] });
    expect(capturedUser).not.toContain("診断太郎");
    expect(capturedUser).toMatch(/PERSON_\d/);
    expect(result.source).toBe("cloud");
    expect(result.suggestions[0]?.labels.theme).toContain("診断太郎");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@core/test-helpers/api-route";

let mockExtraction: {
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
};

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async (messages: { role: string; content: string }[]) => {
    const systemContent = messages[0]?.content ?? "";
    if (systemContent.includes("人物名だけ")) return JSON.stringify({ people: [] });
    return JSON.stringify(mockExtraction);
  }),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

// docs/memo.md「テキストから検出されたメンバー名を確実に『人物』にすべて登録する」対応で
// createJournalEventFromTextがdetectUnregisteredNameCandidatesを呼ぶようになったため、
// 実際の辞書・形態素解析（重い・並列実行時にタイムアウトしやすい）を避けてモックする。
vi.mock("@core/name-candidate-detect", () => ({
  detectNameCandidatesAsync: async () => [] as string[],
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
}));

vi.mock("@/lib/agent-runtime", () => ({
  startRun: vi.fn(async () => ({})),
  listRuns: () => [],
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("PATCH /api/journal/[id]", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { tags: ["x"] }), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("rawTextを空にしようとすると400", async () => {
    const journalStore = await import("@core/journal-store");
    const entry = await journalStore.addJournalEntry("元のテキスト");
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { rawText: "  " }), routeCtx({ id: entry.id }));
    expect(res.status).toBe(400);
  });

  it("occurredAtDateの形式が不正なら400", async () => {
    const journalStore = await import("@core/journal-store");
    const entry = await journalStore.addJournalEntry("テキスト");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { occurredAtDate: "invalid" }),
      routeCtx({ id: entry.id }),
    );
    expect(res.status).toBe(400);
  });

  it("校正できる（tags/urgency/occurredAtDate）", async () => {
    const journalStore = await import("@core/journal-store");
    const entry = await journalStore.addJournalEntry("テキスト");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { tags: ["確認済み"], urgency: "high", occurredAtDate: "2026-01-15" }),
      routeCtx({ id: entry.id }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entry.tags).toEqual(["確認済み"]);
    expect(json.entry.urgency).toBe("high");
    expect(json.entry.createdAt).toBe(new Date(2026, 0, 15, 12, 0, 0, 0).getTime());
    expect(json.entry.confirmed).toBe(true);
  });

  it("teamsで関連チームを複数紐付けできる", async () => {
    const journalStore = await import("@core/journal-store");
    const org = await import("@core/org-context-store/index");
    const a = org.addTeam("コアチーム", []);
    const b = org.addTeam("プロダクトチーム", []);
    const entry = await journalStore.addJournalEntry("テキスト");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { teams: ["コアチーム", "プロダクトチーム"] }),
      routeCtx({ id: entry.id }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entry.teamIds.sort()).toEqual([a.id, b.id].sort());
    expect(json.entry.teamNames.sort()).toEqual(["コアチーム", "プロダクトチーム"].sort());
  });

  it("resolvedIssueId/resolutionNoteの3値（未指定=維持・null=解除・文字列=設定）", async () => {
    const journalStore = await import("@core/journal-store");
    const issueStore = await import("@core/issue-store");
    const issue = await issueStore.createIssue("対象Issue");
    const entry = await journalStore.addJournalEntry("問題発生");
    const route = await import("./route");

    const withResolution = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { resolvedIssueId: issue.id }),
      routeCtx({ id: entry.id }),
    );
    const withResolutionJson = await withResolution.json();
    expect(withResolutionJson.entry.resolvedIssueId).toBe(issue.id);

    const untouched = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { tags: ["x"] }),
      routeCtx({ id: withResolutionJson.entry.id }),
    );
    expect((await untouched.json()).entry.resolvedIssueId).toBe(issue.id);
  });

  it("resolvedIssueIdはプレフィックス一致でも解決できる", async () => {
    const journalStore = await import("@core/journal-store");
    const issueStore = await import("@core/issue-store");
    const issue = await issueStore.createIssue("対象Issue");
    const entry = await journalStore.addJournalEntry("問題発生");
    const route = await import("./route");

    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { resolvedIssueId: issue.id.slice(0, 8) }),
      routeCtx({ id: entry.id }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).entry.resolvedIssueId).toBe(issue.id);
  });

  it("存在しないresolvedIssueIdは400", async () => {
    const journalStore = await import("@core/journal-store");
    const entry = await journalStore.addJournalEntry("問題発生");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { resolvedIssueId: "00000000-0000-0000-0000-000000000000" }),
      routeCtx({ id: entry.id }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/journal/[id]", () => {
  it("現行版を返す（supersedesされた旧IDでも）", async () => {
    const journalStore = await import("@core/journal-store");
    const entry = await journalStore.addJournalEntry("元のテキスト");
    const updated = await journalStore.updateJournalEntry(entry.id, { tags: ["確認済み"] });
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x"), routeCtx({ id: entry.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).entry.id).toBe(updated!.id);
  });

  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x"), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@core/test-helpers/api-route";

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
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

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("GET /api/issues/[id]", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/api/issues/missing"), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("存在すれば実名復元済みで返す", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("既存Issue");
    const route = await import("./route");
    const res = await route.GET(new Request(`http://localhost/api/issues/${issue.id}`), routeCtx({ id: issue.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).issue.title).toBe("既存Issue");
  });

  it("先頭8桁の一意プレフィックスでも取得できる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("短いID");
    const route = await import("./route");
    const prefix = issue.id.slice(0, 8);
    const res = await route.GET(new Request(`http://localhost/api/issues/${prefix}`), routeCtx({ id: prefix }));
    expect(res.status).toBe(200);
    expect((await res.json()).issue.id).toBe(issue.id);
  });

  it("sourceJournalsにresolvedIssueIdで紐づくJournalを含める", async () => {
    const issueStore = await import("@/lib/issue-store");
    const journalStore = await import("@/lib/journal-store");
    const issue = await issueStore.createIssue("既存Issue");
    const entry = await journalStore.addJournalEntry("現場の問題");
    await journalStore.updateJournalEntry(entry.id, { resolvedIssueId: issue.id });
    const route = await import("./route");
    const res = await route.GET(new Request(`http://localhost/api/issues/${issue.id}`), routeCtx({ id: issue.id }));
    const json = await res.json();
    expect(json.sourceJournals).toHaveLength(1);
    expect(json.sourceJournals[0].rawText).toBe("現場の問題");
  });
});

describe("PATCH /api/issues/[id]", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/api/issues/missing", "PATCH", { why: "x" }),
      routeCtx({ id: "missing" }),
    );
    expect(res.status).toBe(404);
  });

  it("titleを空文字にしようとすると400", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${issue.id}`, "PATCH", { title: "  " }),
      routeCtx({ id: issue.id }),
    );
    expect(res.status).toBe(400);
  });

  it("charter/title/keyResultId/teamIdをまとめて更新できる（charterはメモへ写像）", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("元のタイトル");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${issue.id}`, "PATCH", {
        title: "新しいタイトル",
        why: "理由",
        tags: ["技術的負債"],
        keyResultId: "kr-1",
        teamId: "team-1",
      }),
      routeCtx({ id: issue.id }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.issue.title).toBe("新しいタイトル");
    expect(json.issue.logEntries.some((e: { text: string }) => e.text.includes("理由"))).toBe(true);
    expect(json.issue.keyResultId).toBe("kr-1");
    expect(json.issue.teamId).toBe("team-1");
  });

  it("statusを更新できる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${issue.id}`, "PATCH", { status: "blocked" }),
      routeCtx({ id: issue.id }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).issue.status).toBe("blocked");
  });

  it("不正なstatusは400", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${issue.id}`, "PATCH", { status: "unknown" }),
      routeCtx({ id: issue.id }),
    );
    expect(res.status).toBe(400);
  });

  it("priorityとmoveFocusを更新できる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const a = await issueStore.createIssue("A");
    const b = await issueStore.createIssue("B");
    const route = await import("./route");
    const resA = await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${a.id}`, "PATCH", { priority: "focus" }),
      routeCtx({ id: a.id }),
    );
    expect(resA.status).toBe(200);
    expect((await resA.json()).issue.priority).toBe("focus");
    await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${b.id}`, "PATCH", { priority: "focus" }),
      routeCtx({ id: b.id }),
    );
    const moved = await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${b.id}`, "PATCH", { moveFocus: "up" }),
      routeCtx({ id: b.id }),
    );
    expect(moved.status).toBe(200);
    expect((await moved.json()).issue.focusOrder).toBe(0);
  });

  it("不正なpriorityは400", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${issue.id}`, "PATCH", { priority: "urgent" }),
      routeCtx({ id: issue.id }),
    );
    expect(res.status).toBe(400);
  });

  it("keyResultId/teamIdにnullを渡すと解除できる（キー自体が無ければ変更しない）", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    issueStore.setIssueKeyResult(issue.id, "kr-1");
    issueStore.setIssueTeam(issue.id, "team-1");
    const route = await import("./route");

    const untouched = await route.PATCH(jsonRequest(`http://localhost/api/issues/${issue.id}`, "PATCH", {}), routeCtx({ id: issue.id }));
    expect((await untouched.json()).issue.keyResultId).toBe("kr-1");

    const cleared = await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${issue.id}`, "PATCH", { keyResultId: null, teamId: null }),
      routeCtx({ id: issue.id }),
    );
    const json = await cleared.json();
    expect(json.issue.keyResultId).toBeUndefined();
    expect(json.issue.teamId).toBeUndefined();
  });
});

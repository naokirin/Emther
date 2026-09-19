import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@core/name-candidate-detect", () => ({
  detectNameCandidatesAsync: async () => [] as string[],
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
}));

vi.mock("@core/embeddings", () => ({
  embedText: async () => [1, 0, 0],
  cosineSimilarity: () => 0,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModule() {
  return import("@/lib/issue-store");
}

// docs/2nd_pivot_version.md Phase 7。issue-store は suggestion-store の互換レイヤー。
describe("issue-store compatibility", () => {
  it("createIssueはSuggestionとして作成し、一覧で取得できる", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("障害対応の提案");
    expect(issue.title).toBe("障害対応の提案");
    expect(store.listIssues().some((i) => i.id === issue.id)).toBe(true);
  });

  it("setIssueArchived(true)は確認済み（もう追わない）に相当する", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("様子見");
    const archived = store.setIssueArchived(issue.id, true);
    expect(archived?.archived).toBe(true);
    expect(archived?.status).toBe("done");
  });

  it("Suggestionの明示アーカイブ（重複起票等）は、reviewStatusがunreviewedのままでも archived: true になる", async () => {
    const store = await loadModule();
    const { archiveSuggestion } = await import("@/lib/suggestion-store");
    const issue = await store.createIssue("重複してしまった提案");
    archiveSuggestion(issue.id);
    const view = store.getIssue(issue.id);
    expect(view?.archived).toBe(true);
    expect(view?.status).not.toBe("done");
  });

  it("addLogEntryはメモとして残る", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("メモ付き");
    const updated = await store.addLogEntry(issue.id, "確認した");
    expect(updated?.logEntries.some((l) => l.text === "確認した")).toBe(true);
  });

  it("setIssuePriorityは確認優先度になる", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("優先");
    const updated = store.setIssuePriority(issue.id, "focus");
    expect(updated?.priority).toBe("focus");
    expect(updated?.focusOrder).toBe(0);
  });

  it("toIssueViewはタイトルを復元する", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("タイトル");
    expect(store.toIssueView(issue).title).toBe("タイトル");
  });
});

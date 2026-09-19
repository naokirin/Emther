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

// docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。
describe("POST/DELETE /api/journal/[id]/archive", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("アーカイブし、DELETEで解除できる", async () => {
    const journalStore = await import("@/lib/journal-store");
    const entry = await journalStore.addJournalEntry("重複して記録してしまった");
    const route = await import("./route");

    const postRes = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: entry.id }));
    expect(postRes.status).toBe(200);
    const posted = await postRes.json();
    expect(posted.entry.archivedAt).toBeTypeOf("number");

    expect(journalStore.listJournalEntries().map((e) => e.id)).not.toContain(entry.id);

    const deleteRes = await route.DELETE(new Request("http://localhost/x"), routeCtx({ id: entry.id }));
    expect(deleteRes.status).toBe(200);
    const deleted = await deleteRes.json();
    expect(deleted.entry.archivedAt).toBeUndefined();
    expect(journalStore.listJournalEntries().map((e) => e.id)).toContain(entry.id);
  });
});

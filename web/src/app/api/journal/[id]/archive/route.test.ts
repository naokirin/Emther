import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@/lib/test-helpers/api-route";

let mockExtraction: {
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
};

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async (messages: { role: string; content: string }[]) => {
    const systemContent = messages[0]?.content ?? "";
    if (systemContent.includes("人物名だけ")) return JSON.stringify({ people: [] });
    return JSON.stringify(mockExtraction);
  }),
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
  mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "negative", summary: "" };
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

// ユーザー指摘「確認したが対応不要だった、を示せずネガポジの強調を減らせない」対応。
describe("POST/DELETE /api/journal/[id]/no-action-needed", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("確認済み（対応不要）を記録し、DELETEで取り消せる", async () => {
    const journalStore = await import("@/lib/journal-store");
    const entry = await journalStore.addJournalEntry("つらい出来事");
    const route = await import("./route");

    const postRes = await route.POST(
      jsonRequest("http://localhost/x", "POST", { note: "対応不要と判断" }),
      routeCtx({ id: entry.id }),
    );
    expect(postRes.status).toBe(200);
    const posted = await postRes.json();
    expect(posted.entry.sentiment).toBe("negative");
    expect(posted.entry.noActionNeededAt).toBeDefined();
    expect(posted.entry.noActionNeededNote).toBe("対応不要と判断");

    const deleteRes = await route.DELETE(new Request("http://localhost/x"), routeCtx({ id: entry.id }));
    expect(deleteRes.status).toBe(200);
    const deleted = await deleteRes.json();
    expect(deleted.entry.noActionNeededAt).toBeUndefined();
  });
});

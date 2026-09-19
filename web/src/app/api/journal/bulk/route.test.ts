import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { jsonRequest } from "@core/test-helpers/api-route";

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" })),
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

vi.mock("@core/agent-runtime/index", () => ({
  startRun: vi.fn(async () => ({})),
  listRuns: () => [],
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("POST /api/journal/bulk", () => {
  it("textが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { text: "" }));
    expect(res.status).toBe(400);
  });

  it("複数行を1行1エントリとして記録する（201）", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { text: "1件目\n2件目" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.entries).toHaveLength(2);
    expect(json.skippedLines).toBe(0);
  });
});

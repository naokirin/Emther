import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

vi.mock("@emther/core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@emther/core/embeddings", () => ({
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

describe("GET /api/timeline", () => {
  it("空の場合は空配列を返す", async () => {
    const { timelineRoute } = await import("./timeline");
    const res = await timelineRoute.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });

  it("提案作成などの変更履歴を実名復元済みで返す", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    await suggestionStore.createSuggestion("障害対応");
    const { timelineRoute } = await import("./timeline");
    const res = await timelineRoute.request("/");
    const json = await res.json();
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].entityLabel).toBe("障害対応");
  });
});

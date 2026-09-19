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

describe("GET /api/id-resolve", () => {
  it("一意なプレフィックスを返す", async () => {
    const issueStore = await import("@emther/core/issue-store");
    const { idResolveRoute } = await import("./id-resolve");
    const issue = await issueStore.createIssue("解決対象");
    const res = await idResolveRoute.request(`/?q=${issue.id.slice(0, 8)}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matches).toHaveLength(1);
    expect(json.matches[0].id).toBe(issue.id);
    expect(json.matches[0].kind).toBe("issue");
  });

  it("不正なクエリは空配列", async () => {
    const { idResolveRoute } = await import("./id-resolve");
    const res = await idResolveRoute.request("/?q=short");
    expect((await res.json()).matches).toEqual([]);
  });
});

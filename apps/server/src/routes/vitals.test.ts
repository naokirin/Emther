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

describe("GET /api/vitals", () => {
  it("チーム・メンバー未登録なら評価不能(unknown)を返す", async () => {
    const { vitalsRoute } = await import("./vitals");
    const res = await vitalsRoute.request("/");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.oneOnOneCoverage.status).toBe("unknown");
    expect(json.teams).toEqual([]);
  });

  it("membersはPERSON_n IDではなく実名で返す（マスク境界の検証）", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    orgStore.addTeam("Team A", ["Aさん"]);
    const { vitalsRoute } = await import("./vitals");
    const res = await vitalsRoute.request("/");
    const json = await res.json();
    expect(json.teams[0].members).toEqual(["Aさん"]);
    expect(json.oneOnOneCoverage.uncoveredMembers).toEqual(["Aさん"]);
  });
});

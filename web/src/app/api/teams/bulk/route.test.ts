import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

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

describe("POST /api/teams/bulk", () => {
  it("有効な行が無ければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { text: "区切りが無い行" }));
    expect(res.status).toBe(400);
  });

  it("`チーム名: メンバー1, メンバー2`形式を一括登録し、無効な行はskippedに入れる", async () => {
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", { text: "Team A: Aさん, Bさん\n区切りが無い行\nTeam B：Cさん" }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.teams).toHaveLength(2);
    expect(json.teams[0].name).toBe("Team A");
    expect(json.teams[0].members).toEqual(["Aさん", "Bさん"]);
    expect(json.teams[1].name).toBe("Team B");
    expect(json.skipped).toEqual(["区切りが無い行"]);
  });
});

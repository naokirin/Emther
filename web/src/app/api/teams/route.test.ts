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

describe("GET /api/teams", () => {
  it("実名復元済みで一覧を返す", async () => {
    const orgStore = await import("@/lib/org-context-store");
    orgStore.addTeam("Team A", ["Aさん"]);
    const route = await import("./route");
    const res = await route.GET();
    const json = await res.json();
    expect(json.teams[0].members).toEqual(["Aさん"]);
  });
});

describe("POST /api/teams", () => {
  it("nameが「/」だけなど実質空なら400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { name: " / " }));
    expect(res.status).toBe(400);
  });

  it("作成できる（201）", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { name: "Engineering / Team A", members: ["Aさん"] }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.team.name).toBe("Engineering/Team A");
    expect(json.team.members).toEqual(["Aさん"]);
  });
});

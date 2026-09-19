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

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function patch(body: unknown) {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("GET /api/teams", () => {
  it("実名復元済みで一覧を返す", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    orgStore.addTeam("Team A", ["Aさん"]);
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request("/");
    const json = await res.json();
    expect(json.teams[0].members).toEqual(["Aさん"]);
  });
});

describe("POST /api/teams", () => {
  it("nameが「/」だけなど実質空なら400", async () => {
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request("/", post({ name: " / " }));
    expect(res.status).toBe(400);
  });

  it("作成できる（201）", async () => {
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request("/", post({ name: "Engineering / Team A", members: ["Aさん"] }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.team.name).toBe("Engineering/Team A");
    expect(json.team.members).toEqual(["Aさん"]);
  });
});

describe("POST /api/teams/bulk", () => {
  it("有効な行が無ければ400", async () => {
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request("/bulk", post({ text: "区切りが無い行" }));
    expect(res.status).toBe(400);
  });

  it("`チーム名: メンバー1, メンバー2`形式を一括登録し、無効な行はskippedに入れる", async () => {
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request(
      "/bulk",
      post({ text: "Team A: Aさん, Bさん\n区切りが無い行\nTeam B：Cさん" }),
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

describe("PATCH /api/teams/:id", () => {
  it("nameが実質空なら400", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const team = orgStore.addTeam("Team A", []);
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request(`/${team.id}`, patch({ name: "/" }));
    expect(res.status).toBe(400);
  });

  it("存在しないIDは404", async () => {
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request("/missing", patch({ name: "x" }));
    expect(res.status).toBe(404);
  });

  it("名前・メンバー・Mission・制約を更新できる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const team = orgStore.addTeam("Team A", []);
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request(
      `/${team.id}`,
      patch({ name: "Team A改", members: ["Aさん"], mission: "価値を届ける" }),
    );
    const json = await res.json();
    expect(json.team.name).toBe("Team A改");
    expect(json.team.members).toEqual(["Aさん"]);
    expect(json.team.charter.mission).toBe("価値を届ける");
  });
});

describe("DELETE /api/teams/:id", () => {
  it("存在しないIDは404", async () => {
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request("/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("削除できる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const team = orgStore.addTeam("消すチーム", []);
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request(`/${team.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(orgStore.getTeam(team.id)).toBeUndefined();
  });
});

describe("POST /api/teams/:id/archive", () => {
  it("存在しないIDは404", async () => {
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request("/missing/archive", post({}));
    expect(res.status).toBe(404);
  });

  it("archived省略時はトグルする", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const team = orgStore.addTeam("Team A", []);
    const { teamsRoute } = await import("./teams");
    const res = await teamsRoute.request(`/${team.id}/archive`, post({}));
    expect((await res.json()).team.archived).toBe(true);
  });
});

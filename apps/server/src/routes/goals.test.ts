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

describe("GET /api/org/goals", () => {
  it("既定は空配列", async () => {
    const { goalsRoute } = await import("./goals");
    const res = await goalsRoute.request("/");
    expect(await res.json()).toEqual({ goals: [] });
  });
});

describe("POST /api/org/goals", () => {
  it("titleは必須。既定statusはactive", async () => {
    const { goalsRoute } = await import("./goals");
    const bad = await goalsRoute.request("/", post({}));
    expect(bad.status).toBe(400);

    const res = await goalsRoute.request("/", post({ title: "チームの自律性を高めたい", horizon: "mid" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.goal.title).toBe("チームの自律性を高めたい");
    expect(json.goal.horizon).toBe("mid");
    expect(json.goal.status).toBe("active");
  });
});

describe("PATCH/DELETE /api/org/goals/:id", () => {
  it("更新・status変更・削除ができる", async () => {
    const { goalsRoute } = await import("./goals");
    const created = await goalsRoute.request("/", post({ title: "信頼性を高める" }));
    const { goal } = await created.json();

    const patched = await goalsRoute.request(`/${goal.id}`, patch({ title: "信頼性を大きく高める", status: "achieved" }));
    expect(patched.status).toBe(200);
    const patchedJson = await patched.json();
    expect(patchedJson.goal.title).toBe("信頼性を大きく高める");
    expect(patchedJson.goal.status).toBe("achieved");

    const deleted = await goalsRoute.request(`/${goal.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const list = await (await goalsRoute.request("/")).json();
    expect(list.goals).toEqual([]);
  });

  it("不正なstatusは400", async () => {
    const { goalsRoute } = await import("./goals");
    const created = await goalsRoute.request("/", post({ title: "x" }));
    const { goal } = await created.json();
    const res = await goalsRoute.request(`/${goal.id}`, patch({ status: "bogus" }));
    expect(res.status).toBe(400);
  });

  it("存在しないidは404", async () => {
    const { goalsRoute } = await import("./goals");
    const res = await goalsRoute.request("/no-such-id", patch({ title: "x" }));
    expect(res.status).toBe(404);
  });
});

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

describe("PATCH /api/org/objectives/[id]/key-results/[krId]", () => {
  it("titleが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", {}), routeCtx({ id: "missing", krId: "missing" }));
    expect(res.status).toBe(400);
  });

  it("存在しないObjectiveは404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { title: "新KR" }),
      routeCtx({ id: "missing", krId: "missing" }),
    );
    expect(res.status).toBe(404);
  });

  it("タイトルを更新できる", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const objective = await orgStore.addObjective("Objective");
    const withKr = await orgStore.addKeyResult(objective.id, "旧KR");
    const krId = withKr!.keyResults[0].id;
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { title: "新KR" }),
      routeCtx({ id: objective.id, krId }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).objective.keyResults[0].title).toBe("新KR");
  });
});

describe("DELETE /api/org/objectives/[id]/key-results/[krId]", () => {
  it("存在しないObjectiveは404", async () => {
    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x"), routeCtx({ id: "missing", krId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("削除できる", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const objective = await orgStore.addObjective("Objective");
    const withKr = await orgStore.addKeyResult(objective.id, "KR");
    const krId = withKr!.keyResults[0].id;
    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x"), routeCtx({ id: objective.id, krId }));
    expect(res.status).toBe(200);
    expect((await res.json()).objective.keyResults).toHaveLength(0);
  });
});

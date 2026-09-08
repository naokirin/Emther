import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("PATCH /api/org/objectives/[id]", () => {
  it("titleが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", {}), routeCtx({ id: "missing" }));
    expect(res.status).toBe(400);
  });

  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { title: "新タイトル" }), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("改名できる", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const objective = await orgStore.addObjective("旧タイトル");
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { title: "新タイトル" }), routeCtx({ id: objective.id }));
    expect((await res.json()).objective.title).toBe("新タイトル");
  });
});

describe("DELETE /api/org/objectives/[id]", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x"), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("削除できる", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const objective = await orgStore.addObjective("消すObjective");
    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x"), routeCtx({ id: objective.id }));
    expect(res.status).toBe(200);
    expect(orgStore.getObjective(objective.id)).toBeUndefined();
  });
});

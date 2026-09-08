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

describe("POST /api/org/objectives/[id]/key-results", () => {
  it("titleが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: "missing" }));
    expect(res.status).toBe(400);
  });

  it("存在しないObjectiveは404", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { title: "KR" }), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("追加できる（201）", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const objective = await orgStore.addObjective("Objective");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { title: "新規契約10件" }), routeCtx({ id: objective.id }));
    expect(res.status).toBe(201);
    expect((await res.json()).objective.keyResults[0].title).toBe("新規契約10件");
  });
});

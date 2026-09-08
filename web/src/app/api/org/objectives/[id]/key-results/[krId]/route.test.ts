import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { routeCtx } from "@/lib/test-helpers/api-route";

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

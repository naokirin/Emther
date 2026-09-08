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

describe("PATCH /api/teams/[id]", () => {
  it("nameが実質空なら400", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const team = orgStore.addTeam("Team A", []);
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { name: "/" }), routeCtx({ id: team.id }));
    expect(res.status).toBe(400);
  });

  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { name: "x" }), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("名前・メンバー・Mission・制約を更新できる", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const team = orgStore.addTeam("Team A", []);
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { name: "Team A改", members: ["Aさん"], mission: "価値を届ける" }),
      routeCtx({ id: team.id }),
    );
    const json = await res.json();
    expect(json.team.name).toBe("Team A改");
    expect(json.team.members).toEqual(["Aさん"]);
    expect(json.team.charter.mission).toBe("価値を届ける");
  });
});

describe("DELETE /api/teams/[id]", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x"), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("削除できる", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const team = orgStore.addTeam("消すチーム", []);
    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x"), routeCtx({ id: team.id }));
    expect(res.status).toBe(200);
    expect(orgStore.getTeam(team.id)).toBeUndefined();
  });
});

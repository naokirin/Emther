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

describe("GET /api/people/[id]", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x"), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("プロファイルを返す", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const id = peopleDirectory.registerName("Aさん");
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x"), routeCtx({ id }));
    expect(res.status).toBe(200);
    expect((await res.json()).person.name).toBe("Aさん");
  });
});

// ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。
describe("PATCH /api/people/[id]", () => {
  it("addAliasで別名を追加できる", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const id = peopleDirectory.registerName("田中さん");
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { addAlias: "田中" }), routeCtx({ id }));
    expect(res.status).toBe(200);
    expect((await res.json()).person.aliases).toEqual(["田中"]);
  });

  it("removeAliasで別名を取り消せる", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const id = peopleDirectory.registerName("田中さん");
    peopleDirectory.addAlias(id, "田中");
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { removeAlias: "田中" }), routeCtx({ id }));
    expect(res.status).toBe(200);
    expect((await res.json()).person.aliases).toEqual([]);
  });

  it("addAlias/removeAlias/nameどれも無ければ400", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const id = peopleDirectory.registerName("田中さん");
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", {}), routeCtx({ id }));
    expect(res.status).toBe(400);
  });

  it("nameで正式名を変更できる", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const id = peopleDirectory.registerName("田中さん");
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { name: "田中" }), routeCtx({ id }));
    expect(res.status).toBe(200);
    expect((await res.json()).person.name).toBe("田中");
    expect(peopleDirectory.listPeople()[0].aliases).toContain("田中さん");
  });

  it("addAliasが既に別の人物のものなら400", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const id = peopleDirectory.registerName("田中さん");
    peopleDirectory.registerName("佐藤さん");
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { addAlias: "佐藤さん" }), routeCtx({ id }));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/people/[id]", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x"), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("誤登録エントリを削除できる", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const id = peopleDirectory.registerName("誤登録");
    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x"), routeCtx({ id }));
    expect(res.status).toBe(200);
    expect(peopleDirectory.listPeople()).toHaveLength(0);
  });
});

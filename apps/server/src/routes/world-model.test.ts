import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

vi.mock("@emther/core/local-model", () => ({
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

function send(method: string, body?: unknown) {
  return { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined };
}

describe("/api/world-model", () => {
  it("追加→固定→訂正→注釈の一連の操作ができる", async () => {
    const { worldModelRoute } = await import("./world-model");
    const created = await worldModelRoute.request(
      "/",
      send("POST", { kind: "flow", title: "判断の所在", statement: "仕様判断は実質テックリードが行う" }),
    );
    expect(created.status).toBe(201);
    const { element } = await created.json();
    expect(element.status).toBe("adopted");
    expect(element.origin).toBe("user");

    const pinned = await worldModelRoute.request(`/${element.id}/pin`, send("POST"));
    expect((await pinned.json()).element.status).toBe("pinned");

    const noted = await worldModelRoute.request(`/${element.id}/note`, send("PATCH", { note: "先月の1on1で確認" }));
    expect((await noted.json()).element.userNote).toBe("先月の1on1で確認");

    const revised = await worldModelRoute.request(
      `/${element.id}/revise`,
      send("POST", { statement: "仕様判断はPMとテックリードの合議" }),
    );
    const revisedBody = await revised.json();
    expect(revisedBody.element.supersedes).toBe(element.id);

    const list = await (await worldModelRoute.request("/")).json();
    expect(list.elements.map((e: { id: string }) => e.id)).toEqual([revisedBody.element.id]);
  });

  it("不正な入力は 400、未知の ID は 404", async () => {
    const { worldModelRoute } = await import("./world-model");
    const bad = await worldModelRoute.request(
      "/",
      send("POST", { kind: "flow", title: "t", statement: "s", personIds: ["田中"] }),
    );
    expect(bad.status).toBe(400);
    expect((await worldModelRoute.request("/nope/adopt", send("POST"))).status).toBe(404);
    expect((await worldModelRoute.request("/?kind=bogus")).status).toBe(400);
  });
});

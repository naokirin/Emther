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

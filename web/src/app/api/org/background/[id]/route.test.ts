import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

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

describe("PATCH/DELETE /api/org/background/[id]", () => {
  it("更新と削除ができる", async () => {
    const listRoute = await import("../route");
    const created = await listRoute.POST(
      jsonRequest("http://localhost/x", "POST", {
        title: "去年赤字",
        fact: "通期で最終赤字だった",
        scope: "tagged",
        tags: ["finance"],
      }),
    );
    const { background } = await created.json();
    const idRoute = await import("./route");

    const patched = await idRoute.PATCH(
      jsonRequest("http://localhost/x", "PATCH", {
        implication: "採用・投資はコスト感度が高い",
        scope: "always",
      }),
      { params: Promise.resolve({ id: background.id }) },
    );
    expect(patched.status).toBe(200);
    const json = await patched.json();
    expect(json.background.implication).toBe("採用・投資はコスト感度が高い");
    expect(json.background.scope).toBe("always");

    const deleted = await idRoute.DELETE(jsonRequest("http://localhost/x", "DELETE"), {
      params: Promise.resolve({ id: background.id }),
    });
    expect(deleted.status).toBe(200);
    const list = await (await listRoute.GET()).json();
    expect(list.backgrounds).toEqual([]);
  });
});

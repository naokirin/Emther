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

// ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
// URLの:idが統合先（残る側）、body.duplicateIdが統合元（消える側）。
describe("POST /api/people/[id]/merge", () => {
  it("duplicateIdをURLの:idへ統合し、統合後のプロファイルを返す", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const fromId = peopleDirectory.registerName("たなかさん");
    const toId = peopleDirectory.registerName("田中さん");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { duplicateId: fromId }), routeCtx({ id: toId }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.person.id).toBe(toId);
    expect(json.person.aliases).toEqual(["たなかさん"]);
    expect(peopleDirectory.listPeople()).toHaveLength(1);
  });

  it("duplicateIdが無ければ400", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const toId = peopleDirectory.registerName("田中さん");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: toId }));
    expect(res.status).toBe(400);
  });

  it("存在しないduplicateIdは400", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const toId = peopleDirectory.registerName("田中さん");
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", { duplicateId: "PERSON_999" }),
      routeCtx({ id: toId }),
    );
    expect(res.status).toBe(400);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

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

describe("GET /api/knowledge/interpretations", () => {
  it("person未指定なら全件を返す", async () => {
    const route = await import("./route");
    const postRes = await route.POST(jsonRequest("http://localhost/x", "POST", { person: "Aさん", text: "リーダー志向がある" }));
    expect(postRes.status).toBe(201);

    const res = await route.GET(new Request("http://localhost/x"));
    const json = await res.json();
    expect(json.interpretations).toHaveLength(1);
    expect(json.interpretations[0].text).toBe("リーダー志向がある");
  });

  it("未登録personを指定した場合は副作用なく0件", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x?person=未登録さん"));
    expect((await res.json()).interpretations).toEqual([]);
    expect(peopleDirectory.listPeople()).toHaveLength(0); // GETで新規登録されない
  });
});

describe("POST /api/knowledge/interpretations", () => {
  it("person/textが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { person: "Aさん" }));
    expect(res.status).toBe(400);
  });

  it("記録できる（personは新規登録され、実名復元済みで返る）", async () => {
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", { person: "Aさん", text: "成長意欲が高い", tags: ["成長"] }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.interpretation.text).toBe("成長意欲が高い");
    expect(json.interpretation.people).toEqual(["Aさん"]);
    expect(json.interpretation.tags).toEqual(["成長"]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

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

describe("GET /api/people", () => {
  it("登録済みの人物サマリーを返す", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    peopleDirectory.registerName("Aさん");
    const route = await import("./route");
    const res = await route.GET();
    const json = await res.json();
    expect(json.people).toHaveLength(1);
    expect(json.people[0].name).toBe("Aさん");
  });
});

describe("POST /api/people", () => {
  it("人物を直接登録できる", async () => {
    const route = await import("./route");
    const res = await route.POST(
      new Request("http://localhost/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "田中さん" }),
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.person.name).toBe("田中さん");
    expect(json.person.id).toBe("PERSON_1");
  });

  it("空の名前は400", async () => {
    const route = await import("./route");
    const res = await route.POST(
      new Request("http://localhost/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "  " }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("敬称違いの既存人物には同じIDを返す", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    peopleDirectory.registerName("田中さん");
    const route = await import("./route");
    const res = await route.POST(
      new Request("http://localhost/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "田中くん" }),
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.person.id).toBe("PERSON_1");
  });

  it("aliases を同時に登録できる", async () => {
    const route = await import("./route");
    const res = await route.POST(
      new Request("http://localhost/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "山田さん", aliases: ["山田くん", "Yamada"] }),
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.person.name).toBe("山田さん");
    expect(json.person.aliases).toEqual(expect.arrayContaining(["山田くん", "Yamada"]));
  });
});

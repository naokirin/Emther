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

describe("GET /api/em-self/reflection-notes", () => {
  it("空なら空配列", async () => {
    const route = await import("./route");
    expect(await (await route.GET()).json()).toEqual({ notes: [] });
  });
});

describe("POST /api/em-self/reflection-notes", () => {
  it("typeが不正なら400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { type: "invalid", text: "x" }));
    expect(res.status).toBe(400);
  });

  it("textが空なら400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { type: "keep", text: "  " }));
    expect(res.status).toBe(400);
  });

  it("記録できる（201）", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { type: "problem", text: "1on1の頻度が不足" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.note.type).toBe("problem");
    expect(json.note.text).toBe("1on1の頻度が不足");
  });
});

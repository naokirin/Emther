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

describe("GET /api/em-self/checkins", () => {
  it("空なら空配列", async () => {
    const route = await import("./route");
    expect(await (await route.GET()).json()).toEqual({ checkins: [] });
  });
});

describe("POST /api/em-self/checkins", () => {
  it("mood/energy/stressが数値でなければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { mood: "x", energy: 3, stress: 3 }));
    expect(res.status).toBe(400);
  });

  it("記録できる（201、範囲外の値はクランプされる）", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { mood: 10, energy: 3, stress: -5, note: "疲れた" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.checkin.mood).toBe(5);
    expect(json.checkin.stress).toBe(1);
    expect(json.checkin.note).toBe("疲れた");
  });

  it("createdAtDateを指定すると日付レベルで記録される", async () => {
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", { mood: 3, energy: 3, stress: 3, createdAtDate: "2026-01-15" }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.checkin.createdAt).toBe(new Date(2026, 0, 15, 12, 0, 0, 0).getTime());
  });

  it("createdAtDateの形式が不正なら400", async () => {
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", { mood: 3, energy: 3, stress: 3, createdAtDate: "not-a-date" }),
    );
    expect(res.status).toBe(400);
  });
});

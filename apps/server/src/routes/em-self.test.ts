import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function patch(body: unknown) {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("GET /api/em-self/checkins", () => {
  it("空なら空配列", async () => {
    const { checkinsRoute } = await import("./em-self");
    expect(await (await checkinsRoute.request("/")).json()).toEqual({ checkins: [] });
  });
});

describe("POST /api/em-self/checkins", () => {
  it("mood/energy/stressが数値でなければ400", async () => {
    const { checkinsRoute } = await import("./em-self");
    const res = await checkinsRoute.request("/", post({ mood: "x", energy: 3, stress: 3 }));
    expect(res.status).toBe(400);
  });

  it("記録できる（201、範囲外の値はクランプされる）", async () => {
    const { checkinsRoute } = await import("./em-self");
    const res = await checkinsRoute.request("/", post({ mood: 10, energy: 3, stress: -5, note: "疲れた" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.checkin.mood).toBe(5);
    expect(json.checkin.stress).toBe(1);
    expect(json.checkin.note).toBe("疲れた");
  });

  it("createdAtDateを指定すると日付レベルで記録される", async () => {
    const { checkinsRoute } = await import("./em-self");
    const res = await checkinsRoute.request("/", post({ mood: 3, energy: 3, stress: 3, createdAtDate: "2026-01-15" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.checkin.createdAt).toBe(new Date(2026, 0, 15, 12, 0, 0, 0).getTime());
  });

  it("createdAtDateの形式が不正なら400", async () => {
    const { checkinsRoute } = await import("./em-self");
    const res = await checkinsRoute.request("/", post({ mood: 3, energy: 3, stress: 3, createdAtDate: "not-a-date" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/em-self/reflection-notes", () => {
  it("空なら空配列", async () => {
    const { reflectionNotesRoute } = await import("./em-self");
    expect(await (await reflectionNotesRoute.request("/")).json()).toEqual({ notes: [] });
  });
});

describe("POST /api/em-self/reflection-notes", () => {
  it("typeが不正なら400", async () => {
    const { reflectionNotesRoute } = await import("./em-self");
    const res = await reflectionNotesRoute.request("/", post({ type: "invalid", text: "x" }));
    expect(res.status).toBe(400);
  });

  it("textが空なら400", async () => {
    const { reflectionNotesRoute } = await import("./em-self");
    const res = await reflectionNotesRoute.request("/", post({ type: "keep", text: "  " }));
    expect(res.status).toBe(400);
  });

  it("記録できる（201）", async () => {
    const { reflectionNotesRoute } = await import("./em-self");
    const res = await reflectionNotesRoute.request("/", post({ type: "problem", text: "1on1の頻度が不足" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.note.type).toBe("problem");
    expect(json.note.text).toBe("1on1の頻度が不足");
  });

  it("createdAtDateを指定すると日付レベルで記録される", async () => {
    const { reflectionNotesRoute } = await import("./em-self");
    const res = await reflectionNotesRoute.request(
      "/",
      post({ type: "keep", text: "前日の気づき", createdAtDate: "2026-01-14" }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.note.createdAt).toBe(new Date(2026, 0, 14, 12, 0, 0, 0).getTime());
  });

  it("createdAtDateの形式が不正なら400", async () => {
    const { reflectionNotesRoute } = await import("./em-self");
    const res = await reflectionNotesRoute.request("/", post({ type: "try", text: "x", createdAtDate: "invalid" }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/em-self/reflection-notes/:id", () => {
  it("archivedが無い／型不正なら400", async () => {
    const { reflectionNotesRoute } = await import("./em-self");
    const res = await reflectionNotesRoute.request("/x", patch({}));
    expect(res.status).toBe(400);
  });

  it("存在しないidなら404", async () => {
    const { reflectionNotesRoute } = await import("./em-self");
    const res = await reflectionNotesRoute.request("/no-such-id", patch({ archived: true }));
    expect(res.status).toBe(404);
  });

  it("archived=trueで完了にでき、falseで戻せる", async () => {
    const { reflectionNotesRoute } = await import("./em-self");
    const createRes = await reflectionNotesRoute.request("/", post({ type: "try", text: "割り込みを減らす" }));
    const { note } = await createRes.json();

    const archiveRes = await reflectionNotesRoute.request(`/${note.id}`, patch({ archived: true }));
    expect(archiveRes.status).toBe(200);
    const archived = await archiveRes.json();
    expect(archived.note.archivedAt).toEqual(expect.any(Number));

    const restoreRes = await reflectionNotesRoute.request(`/${note.id}`, patch({ archived: false }));
    expect(restoreRes.status).toBe(200);
    const restored = await restoreRes.json();
    expect(restored.note.archivedAt).toBeUndefined();
  });
});

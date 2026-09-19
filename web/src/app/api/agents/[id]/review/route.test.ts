import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@core/test-helpers/api-route";

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@core/embeddings", () => ({
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

async function insertRunRow() {
  const { getDb } = await import("@/lib/db");
  getDb()
    .prepare(
      `INSERT INTO agent_runs
        (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("run-1", "Lead Agent", "task", "idle", 0, 1, 1, "auto-anomaly", 0);
}

describe("POST /api/agents/[id]/review", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("triageStatus未指定ならreviewedをtrueにする", async () => {
    await insertRunRow();
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: "run-1" }));
    const json = await res.json();
    expect(json.run.reviewed).toBe(true);
    expect(json.run.triageStatus).toBeUndefined();
  });

  it("triageStatus:watching/dismissedを設定できる", async () => {
    await insertRunRow();
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { triageStatus: "watching" }), routeCtx({ id: "run-1" }));
    expect((await res.json()).run.triageStatus).toBe("watching");
  });

  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。
  it("archived:trueでアーカイブし、falseで解除できる（reviewedは強制しない）", async () => {
    await insertRunRow();
    const route = await import("./route");
    const archiveRes = await route.POST(jsonRequest("http://localhost/x", "POST", { archived: true }), routeCtx({ id: "run-1" }));
    const archived = await archiveRes.json();
    expect(archived.run.archivedAt).toBeTypeOf("number");
    expect(archived.run.reviewed).toBe(false);

    const unarchiveRes = await route.POST(jsonRequest("http://localhost/x", "POST", { archived: false }), routeCtx({ id: "run-1" }));
    expect((await unarchiveRes.json()).run.archivedAt).toBeUndefined();
  });

  it("archivedが真偽値でない場合は400", async () => {
    await insertRunRow();
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { archived: "yes" }), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(400);
  });
});

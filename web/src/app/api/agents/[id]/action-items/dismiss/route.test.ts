import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { routeCtx } from "@/lib/test-helpers/api-route";

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

async function insertRunRow() {
  const { getDb } = await import("@/lib/db");
  getDb()
    .prepare(
      `INSERT INTO agent_runs
        (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed, suggested_action_items_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("run-1", "Lead Agent", "task", "idle", 0, 1, 1, "manual", 1, JSON.stringify(["やること1"]));
}

describe("POST /api/agents/[id]/action-items/dismiss", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.POST(new Request("http://localhost/x", { method: "POST" }), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("提案を消す", async () => {
    await insertRunRow();
    const route = await import("./route");
    const res = await route.POST(new Request("http://localhost/x", { method: "POST" }), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).run.suggestedActionItems).toBeUndefined();
  });
});

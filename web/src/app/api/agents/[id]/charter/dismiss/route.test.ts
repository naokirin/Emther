import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { routeCtx } from "@/lib/test-helpers/api-route";

// route → agent-runtime → people-directory/embeddings が @huggingface/transformers を
// 実ロードすると、lint/build 並行時などに 5s タイムアウトすることがある。
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
        (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed, suggested_charter_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("run-1", "Lead Agent", "task", "idle", 0, 1, 1, "manual", 1, JSON.stringify({ why: "価値" }));
}

describe("POST /api/agents/[id]/charter/dismiss", () => {
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
    expect((await res.json()).run.suggestedCharter).toBeUndefined();
  });
});

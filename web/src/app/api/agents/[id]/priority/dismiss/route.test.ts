import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { routeCtx } from "@/lib/test-helpers/api-route";

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

describe("POST /api/agents/[id]/priority/dismiss", () => {
  it("優先度提案を消せる", async () => {
    const { getDb } = await import("@/lib/db");
    getDb()
      .prepare(
        `INSERT INTO agent_runs
          (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed, suggested_priority_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("run-1", "Lead Agent", "t", "idle", 0, 1, 1, "manual", 1, JSON.stringify("focus"));
    const rt = await import("@/lib/agent-runtime");
    expect(rt.getRun("run-1")?.suggestedPriority).toBe("focus");
    const route = await import("./route");
    const res = await route.POST(new Request("http://localhost/x", { method: "POST" }), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).run.suggestedPriority).toBeUndefined();
  });
});

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

function insertRunRow(overrides: Partial<Record<string, unknown>> = {}) {
  return import("@/lib/db").then(({ getDb }) => {
    const base = {
      id: "run-1",
      agent_name: "Lead Agent",
      task: "タスク",
      status: "idle",
      session_id: null,
      agy_conversation_id: null,
      cursor_session_id: null,
      yield_request_json: null,
      proposal_json: null,
      suggested_action_items_json: null,
      suggested_sub_issues_json: null,
      total_cost_usd: 0,
      created_at: 1,
      updated_at: 1,
      consulted_by: null,
      origin: "manual",
      reviewed: 1,
      triage_status: null,
      triage_at: null,
      ...overrides,
    };
    getDb()
      .prepare(
        `INSERT INTO agent_runs
          (id, agent_name, task, status, session_id, agy_conversation_id, cursor_session_id, yield_request_json, proposal_json, suggested_action_items_json, suggested_sub_issues_json, total_cost_usd, created_at, updated_at, consulted_by, origin, reviewed, triage_status, triage_at)
         VALUES (@id, @agent_name, @task, @status, @session_id, @agy_conversation_id, @cursor_session_id, @yield_request_json, @proposal_json, @suggested_action_items_json, @suggested_sub_issues_json, @total_cost_usd, @created_at, @updated_at, @consulted_by, @origin, @reviewed, @triage_status, @triage_at)`,
      )
      .run(base);
  });
}

describe("GET /api/agents/[id]", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x"), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("存在すれば実名復元済みで返す", async () => {
    await insertRunRow({ task: "PERSON_1についてのタスク" });
    const peopleDirectory = await import("@/lib/people-directory");
    peopleDirectory.registerName("Aさん"); // PERSON_1として登録
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x"), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).run.task).toBe("Aさんについてのタスク");
  });
});

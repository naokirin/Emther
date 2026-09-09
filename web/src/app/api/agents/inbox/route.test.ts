import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

// このルートはCLIを起動しないが、agent-runtime.tsの起動時復旧ロジックが
// node:child_process等をimportするため、他のテストと同じくlocal-model/embeddingsをモックする。
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

function insertRunRow(db: import("node:sqlite").DatabaseSync, overrides: Partial<Record<string, unknown>> = {}) {
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
    created_at: 1000,
    updated_at: 1000,
    consulted_by: null,
    origin: "manual",
    reviewed: 1,
    triage_status: null,
    triage_at: null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO agent_runs
      (id, agent_name, task, status, session_id, agy_conversation_id, cursor_session_id, yield_request_json, proposal_json, suggested_action_items_json, suggested_sub_issues_json, total_cost_usd, created_at, updated_at, consulted_by, origin, reviewed, triage_status, triage_at)
     VALUES (@id, @agent_name, @task, @status, @session_id, @agy_conversation_id, @cursor_session_id, @yield_request_json, @proposal_json, @suggested_action_items_json, @suggested_sub_issues_json, @total_cost_usd, @created_at, @updated_at, @consulted_by, @origin, @reviewed, @triage_status, @triage_at)`,
  ).run(base);
}

describe("GET /api/agents/inbox", () => {
  it("既定はpageSize=5・却下(dismissed)を除外して返す", async () => {
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), { id: "run-1", created_at: 2 });
    insertRunRow(getDb(), { id: "run-2", created_at: 1, triage_status: "dismissed" });
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/api/agents/inbox"));
    const json = await res.json();
    expect(json.runs.map((r: { id: string }) => r.id)).toEqual(["run-1"]);
    expect(json.total).toBe(1);
    expect(json.pageSize).toBe(5);
  });

  it("page/pageSize/status/showDismissedクエリを反映する", async () => {
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), { id: "run-1", created_at: 3, status: "idle" });
    insertRunRow(getDb(), { id: "run-2", created_at: 2, status: "yield" });
    insertRunRow(getDb(), { id: "run-3", created_at: 1, status: "idle", triage_status: "dismissed" });
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/api/agents/inbox?status=yield&showDismissed=1&page=1&pageSize=1"));
    const json = await res.json();
    expect(json.runs.map((r: { id: string }) => r.id)).toEqual(["run-2"]);
    expect(json.total).toBe(1);
  });

  it("不正なstatus値は無視する", async () => {
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), { id: "run-1" });
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/api/agents/inbox?status=bogus"));
    const json = await res.json();
    expect(json.total).toBe(1);
  });
});

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

// このルートはstartRunを呼ぶため、実CLIを起動しないようnode:child_processのspawnを
// モックする（web/src/app/api/agents/route.test.ts と同じパターン）。
vi.mock("@emther/core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));
vi.mock("@emther/core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

const spawnRef = vi.hoisted(() => ({
  impl: (() => {
    throw new Error("spawn is not mocked for this test");
  }) as (command: string, args: string[]) => unknown,
}));
vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[]) => spawnRef.impl(command, args),
}));

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  spawnRef.impl = () => new FakeChildProcess();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("GET /api/agents", () => {
  it("空なら空配列とpendingAgentStarts", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/");
    expect(await res.json()).toEqual({ runs: [], pendingAgentStarts: [], pendingUnmaskedSends: [] });
  });
});

describe("POST /api/agents", () => {
  it("agentName/taskが無ければ400", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/", post({ agentName: "Lead Agent" }));
    expect(res.status).toBe(400);
  });

  it("起動できる（201）。CLI起動自体は別途モックしたspawnを使う", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/", post({ agentName: "Lead Agent", task: "タスク" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.run.agentName).toBe("Lead Agent");
    expect(json.run.status).toBe("active");
  });

  it("sourceJournalIdを渡すとrunに保存する", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/", post({ agentName: "Lead Agent", task: "タスク", sourceJournalId: "j-1" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.run.sourceJournalId).toBe("j-1");
  });

  it("requireExecConsultでrequiredConsultAgentsにExec Agentが入る", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/", post({ agentName: "Lead Agent", task: "方針相談", requireExecConsult: true }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.run.requiredConsultAgents).toEqual(["Exec Agent"]);
  });

  it("未確認の人名候補が含まれている場合は409を返し、確認後は201で起動できる", async () => {
    const { agentsRoute } = await import("./agents");
    // 未確認の「佐藤さん」が含まれるタスク
    const res1 = await agentsRoute.request("/", post({ agentName: "Lead Agent", task: "佐藤さんと1on1の進め方について相談したい" }));
    expect(res1.status).toBe(409);
    const json1 = await res1.json();
    expect(json1.code).toBe("NAME_CANDIDATE_CONFIRMATION_REQUIRED");
    expect(json1.candidates).toContain("佐藤さん");

    // 確認（allowUnmaskedNameCandidates: true）を指定して送信
    const res2 = await agentsRoute.request(
      "/",
      post({ agentName: "Lead Agent", task: "佐藤さんと1on1の進め方について相談したい", allowUnmaskedNameCandidates: true }),
    );
    expect(res2.status).toBe(201);
    const json2 = await res2.json();
    expect(json2.run.status).toBe("active");
  });
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
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), { id: "run-1", created_at: 2 });
    insertRunRow(getDb(), { id: "run-2", created_at: 1, triage_status: "dismissed" });
    const { agentsInboxRoute } = await import("./agents");
    const res = await agentsInboxRoute.request("/");
    const json = await res.json();
    expect(json.runs.map((r: { id: string }) => r.id)).toEqual(["run-1"]);
    expect(json.total).toBe(1);
    expect(json.pageSize).toBe(5);
  });

  it("page/pageSize/status/showDismissedクエリを反映する", async () => {
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), { id: "run-1", created_at: 3, status: "idle" });
    insertRunRow(getDb(), { id: "run-2", created_at: 2, status: "yield" });
    insertRunRow(getDb(), { id: "run-3", created_at: 1, status: "idle", triage_status: "dismissed" });
    const { agentsInboxRoute } = await import("./agents");
    const res = await agentsInboxRoute.request("/?status=yield&showDismissed=1&page=1&pageSize=1");
    const json = await res.json();
    expect(json.runs.map((r: { id: string }) => r.id)).toEqual(["run-2"]);
    expect(json.total).toBe(1);
  });

  it("不正なstatus値は無視する", async () => {
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), { id: "run-1" });
    const { agentsInboxRoute } = await import("./agents");
    const res = await agentsInboxRoute.request("/?status=bogus");
    const json = await res.json();
    expect(json.total).toBe(1);
  });
});

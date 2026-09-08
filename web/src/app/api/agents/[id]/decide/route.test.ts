import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));
vi.mock("@/lib/embeddings", () => ({
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

async function insertRunRow(status = "idle") {
  const { getDb } = await import("@/lib/db");
  getDb()
    .prepare(
      `INSERT INTO agent_runs
        (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("run-1", "Lead Agent", "task", status, 0, 1, 1, "manual", 1);
}

describe("POST /api/agents/[id]/decide", () => {
  it("messageが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { message: "  " }), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(400);
  });

  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { message: "続けて" }), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("実行中(active)のrunへは409を返す", async () => {
    // loadRunsFromDb()はDBから読み込んだ"active"行を（サーバー再起動想定で）"error"に
    // 変換してしまうため、DB直接投入では真にactiveな状態を再現できない。実際にstartRunで
    // 起動し、spawnしたCLIプロセスをcloseさせないことで本物のactive状態を作る。
    const agentRuntime = await import("@/lib/agent-runtime");
    const run = await agentRuntime.startRun("Lead Agent", "実行中のタスク");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { message: "続けて" }), routeCtx({ id: run.id }));
    expect(res.status).toBe(409);
  });

  it("idle状態のrunを再開できる", async () => {
    await insertRunRow("idle");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { message: "続けて" }), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).run.status).toBe("active");
  });
});

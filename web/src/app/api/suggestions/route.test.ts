import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";

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

async function insertRun(id: string, reviewed = 0) {
  const { getDb } = await import("@/lib/db");
  getDb()
    .prepare(
      `INSERT INTO agent_runs
        (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, "Lead Agent", "方針を相談したい", "idle", 0, 1, 1, "manual", reviewed);
}

async function insertRunWithProposal(id: string, proposal: Record<string, unknown>) {
  const { getDb } = await import("@/lib/db");
  getDb()
    .prepare(
      `INSERT INTO agent_runs
        (id, agent_name, task, status, proposal_json, total_cost_usd, created_at, updated_at, origin, reviewed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, "Lead Agent", "方針を相談したい", "idle", JSON.stringify(proposal), 0, 1, 1, "manual", 0);
}

describe("POST /api/suggestions", () => {
  it("sourceRunIdのみのときは相談を吸収せず、新規分析Runも起動しない", async () => {
    await insertRun("run-consult", 0);
    const runtime = await import("@/lib/agent-runtime");
    const startSpy = vi.spyOn(runtime, "startRun").mockResolvedValue({
      id: "should-not-run",
      agentName: "Lead Agent",
      task: "x",
      status: "idle",
      log: [],
      totalCostUsd: 0,
      createdAt: 1,
      updatedAt: 1,
      origin: "manual",
      reviewed: true,
    });
    const route = await import("./route");
    const res = await route.POST(
      new Request("http://localhost/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "分割提案A", sourceRunId: "run-consult" }),
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.suggestion.sourceRunId).toBe("run-consult");
    expect(json.suggestion.agentRunId).toBeUndefined();
    expect(startSpy).not.toHaveBeenCalled();
    expect(runtime.getRun("run-consult")?.reviewed).toBe(true);
    startSpy.mockRestore();
  });

  it("agentRunIdもsourceRunIdも無いときは分析Runを起動する", async () => {
    const runtime = await import("@/lib/agent-runtime");
    const startSpy = vi.spyOn(runtime, "startRun").mockResolvedValue({
      id: "run-new",
      agentName: "Lead Agent",
      task: "新しいIssueが起票されました",
      status: "active",
      log: [],
      totalCostUsd: 0,
      createdAt: 1,
      updatedAt: 1,
      origin: "manual",
      reviewed: true,
    });
    const route = await import("./route");
    const res = await route.POST(
      new Request("http://localhost/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Journalから提案" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(startSpy).toHaveBeenCalledTimes(1);
    startSpy.mockRestore();
  });

  // docs/memo.md「メモとは別に提案自体の詳細を残す単一の場所」対応。
  it("sourceRunにproposalがあれば起票時にdetailとして残す", async () => {
    await insertRunWithProposal("run-with-proposal", {
      conclusion: "結論だよ",
      facts: ["ファクトA"],
      logic: "ロジックだよ",
      rejectedAlternatives: [],
      expansions: ["別の問題設定もあり得る"],
      challenges: ["本当に発言量が問題か"],
      advice: "計画のアドバイス",
    });
    const route = await import("./route");
    const res = await route.POST(
      new Request("http://localhost/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "詳細つき提案", sourceRunId: "run-with-proposal" }),
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.suggestion.detail?.conclusion).toBe("結論だよ");
    expect(json.suggestion.detail?.facts).toEqual(["ファクトA"]);
    expect(json.suggestion.detail?.expansions).toEqual(["別の問題設定もあり得る"]);
    expect(json.suggestion.detail?.challenges).toEqual(["本当に発言量が問題か"]);
    expect(json.suggestion.detail?.advice).toBe("計画のアドバイス");
  });

  it("sourceRunにproposalが無ければdetailは付かない", async () => {
    await insertRun("run-no-proposal", 0);
    const route = await import("./route");
    const res = await route.POST(
      new Request("http://localhost/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "詳細なし提案", sourceRunId: "run-no-proposal" }),
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.suggestion.detail).toBeUndefined();
  });
});

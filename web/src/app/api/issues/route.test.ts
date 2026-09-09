import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

// このAPIは素のIssue作成（agentRunId無し）のたびにLead Agentの分析Run
// （agent-runtime.ts側のstartRun）を自動で起動するようになった。CLI子プロセスを
// 実際に起動してしまわないよう、agent-runtime.test.tsと同じ方針でnode:child_processの
// spawnをモックする（テスト自体はrunの完了を待たないため、フェイクの子プロセスは
// エラーで終了させるだけで十分）。
vi.mock("node:child_process", () => ({
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => child.emit("error", new Error("spawn claude ENOENT (mocked in test)")));
    return child;
  },
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("GET /api/issues", () => {
  it("一覧を実名復元済みで返す", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const issueStore = await import("@/lib/issue-store");
    peopleDirectory.registerName("Aさん");
    await issueStore.createIssue("Aさんの育成計画");

    const route = await import("./route");
    const res = await route.GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.issues).toHaveLength(1);
    expect(json.issues[0].title).toBe("Aさんの育成計画");
  });
});

describe("POST /api/issues", () => {
  it("titleが無ければ400を返す", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/api/issues", "POST", { title: "  " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("titleは必須です");
  });

  it("bodyがJSONでなくても400として扱う（クラッシュしない）", async () => {
    const route = await import("./route");
    const res = await route.POST(new Request("http://localhost/api/issues", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("最小限の入力で201を返す", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/api/issues", "POST", { title: "新しいIssue" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.issue.title).toBe("新しいIssue");
    expect(json.issue.charter).toEqual({ why: "", what: "", how: "" });
  });

  it("charter/tags/parentId/keyResultId/teamIdを渡すと反映される", async () => {
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/issues", "POST", {
        title: "詳細付きIssue",
        why: "理由",
        what: "内容",
        how: "方法",
        tags: ["技術的負債", 123],
        keyResultId: "kr-1",
        teamId: "team-1",
      }),
    );
    const json = await res.json();
    expect(json.issue.charter).toEqual({ why: "理由", what: "内容", how: "方法" });
    expect(json.issue.tags).toEqual(["技術的負債"]);
    expect(json.issue.keyResultId).toBe("kr-1");
    expect(json.issue.teamId).toBe("team-1");
  });

  it("親Issueが存在しない場合は400を返す", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/api/issues", "POST", { title: "子Issue", parentId: "missing" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("親Issueが見つかりません");
  });

  it("agentRunIdを渡すとそのrunをreviewed済みにする", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({});
    const dbModule = await import("@/lib/db");
    dbModule
      .getDb()
      .prepare(
        `INSERT INTO agent_runs (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("run-1", "Lead Agent", "task", "idle", 0, 1, 1, "auto-anomaly", 0);
    const agentRuntime = await import("@/lib/agent-runtime");
    expect(agentRuntime.getRun("run-1")?.reviewed).toBe(false);

    const route = await import("./route");
    await route.POST(jsonRequest("http://localhost/api/issues", "POST", { title: "AI起点のIssue", agentRunId: "run-1" }));
    expect(agentRuntime.getRun("run-1")?.reviewed).toBe(true);

    // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
    // 対応。agentRunIdを渡した場合（＝既存のAgent Runから起票された場合）は、
    // それ以上Lead Agentの分析Runを新たに起動しない（重複起動しない）。
    expect(agentRuntime.listRuns()).toHaveLength(1);
  });

  it("agentRunIdを渡さない場合はLead Agentの分析Runを自動で起動し、Issueに紐づける", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/api/issues", "POST", { title: "Journal起点のIssue", why: "本文" }));
    const json = await res.json();

    const agentRuntime = await import("@/lib/agent-runtime");
    const runs = agentRuntime.listRuns();
    // チーム先行並列（既定ON）: Lead + 関連specialist（タグ無しなら4体）= 5
    expect(runs).toHaveLength(5);
    const lead = runs.find((r) => r.agentName === "Lead Agent");
    expect(lead).toBeDefined();
    expect(lead!.task).toContain("Journal起点のIssue");
    expect(json.issue.agentRunId).toBe(lead!.id);
    expect(runs.filter((r) => r.consultedBy === lead!.id)).toHaveLength(4);
  });

  it("AIチームの分析起動に失敗してもIssueの起票自体は成功する", async () => {
    const agentRuntime = await import("@/lib/agent-runtime");
    vi.spyOn(agentRuntime, "startRun").mockRejectedValueOnce(new Error("起動失敗"));

    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/api/issues", "POST", { title: "起動失敗しても作られるIssue" }));
    expect(res.status).toBe(201);
    expect((await res.json()).issue.title).toBe("起動失敗しても作られるIssue");
  });
});

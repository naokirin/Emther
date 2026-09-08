import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

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
  });
});

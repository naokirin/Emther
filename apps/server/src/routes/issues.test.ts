import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

vi.mock("@emther/core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@emther/core/embeddings", () => ({
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

// docs/memo.md「テキストから検出されたメンバー名を確実に『人物』にすべて登録する」対応で
// createJournalEventFromTextがdetectUnregisteredNameCandidatesを呼ぶようになったため、
// 実際の辞書・形態素解析（重い・並列実行時にタイムアウトしやすい）を避けてモックする。
vi.mock("@emther/core/name-candidate-detect", () => ({
  detectNameCandidatesAsync: async () => [] as string[],
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function patch(body: unknown) {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("GET /api/issues", () => {
  it("一覧を実名復元済みで返す", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const issueStore = await import("@emther/core/issue-store");
    peopleDirectory.registerName("Aさん");
    await issueStore.createIssue("Aさんの育成計画");

    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request("/");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.issues).toHaveLength(1);
    expect(json.issues[0].title).toBe("Aさんの育成計画");
  });
});

describe("POST /api/issues", () => {
  it("titleが無ければ400を返す", async () => {
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request("/", post({ title: "  " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("titleは必須です");
  });

  it("bodyがJSONでなくても400として扱う（クラッシュしない）", async () => {
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request("/", { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
  });

  it("最小限の入力で201を返す", async () => {
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request("/", post({ title: "新しいIssue" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.issue.title).toBe("新しいIssue");
    expect(json.issue.charter).toEqual({ why: "", what: "", how: "" });
  });

  it("charter/keyResultId/teamIdを渡すと反映される（charterはメモへ写像）", async () => {
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request(
      "/",
      post({
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
    expect(json.issue.title).toBe("詳細付きIssue");
    expect(json.issue.logEntries.some((e: { text: string }) => e.text.includes("Why: 理由"))).toBe(true);
    expect(json.issue.keyResultId).toBe("kr-1");
    expect(json.issue.teamId).toBe("team-1");
  });

  it("parentIdは階層廃止のため無視され、トップレベル提案として作成できる", async () => {
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request("/", post({ title: "子Issue", parentId: "missing" }));
    expect(res.status).toBe(201);
    expect((await res.json()).issue.title).toBe("子Issue");
  });

  it("agentRunIdを渡すとそのrunをreviewed済みにする", async () => {
    const settingsStore = await import("@emther/core/settings-store");
    settingsStore.updateRulesAndConstraints({});
    const dbModule = await import("@emther/core/db");
    dbModule
      .getDb()
      .prepare(
        `INSERT INTO agent_runs (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("run-1", "Lead Agent", "task", "idle", 0, 1, 1, "auto-anomaly", 0);
    const agentRuntime = await import("@emther/core/agent-runtime/index");
    expect(agentRuntime.getRun("run-1")?.reviewed).toBe(false);

    const { issuesRoute } = await import("./issues");
    await issuesRoute.request("/", post({ title: "AI起点のIssue", agentRunId: "run-1" }));
    expect(agentRuntime.getRun("run-1")?.reviewed).toBe(true);

    // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
    // 対応。agentRunIdを渡した場合（＝既存のAgent Runから起票された場合）は、
    // それ以上Lead Agentの分析Runを新たに起動しない（重複起動しない）。
    expect(agentRuntime.listRuns()).toHaveLength(1);
  });

  it("相談のrunにsourceJournalIdがあればIssueへコピーしJournalも紐付ける", async () => {
    const knowledgeStore = await import("@emther/core/knowledge-store");
    knowledgeStore.recordEvent({
      id: "j-fixed",
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "現場の問題",
      tags: [],
      occurredAt: Date.now(),
    });
    const dbModule = await import("@emther/core/db");
    dbModule
      .getDb()
      .prepare(
        `INSERT INTO agent_runs (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed, source_journal_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("run-src", "Lead Agent", "task", "idle", 0, 1, 1, "auto-anomaly", 0, "j-fixed");

    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request("/", post({ title: "AI起点のIssue", agentRunId: "run-src" }));
    const json = await res.json();
    expect(json.issue.sourceJournalId).toBe("j-fixed");
    expect(json.issue.sourceRunId).toBe("run-src");

    const journalStore = await import("@emther/core/journal-store");
    expect(journalStore.getCurrentJournalEntry("j-fixed")?.resolvedIssueId).toBe(json.issue.id);
  });

  it("sourceRunIdのみでも生成元を残し、Journal紐付けとreviewedは行わない", async () => {
    const knowledgeStore = await import("@emther/core/knowledge-store");
    knowledgeStore.recordEvent({
      id: "j-sib",
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "複数課題の種",
      tags: [],
      occurredAt: Date.now(),
    });
    const dbModule = await import("@emther/core/db");
    dbModule
      .getDb()
      .prepare(
        `INSERT INTO agent_runs (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed, source_journal_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("run-multi", "Lead Agent", "task", "idle", 0, 1, 1, "auto-anomaly", 0, "j-sib");

    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request("/", post({ title: "兄弟Issue", sourceRunId: "run-multi" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.issue.sourceRunId).toBe("run-multi");
    expect(json.issue.sourceJournalId).toBe("j-sib");
    expect(json.issue.agentRunId).not.toBe("run-multi");

    const agentRuntime = await import("@emther/core/agent-runtime/index");
    expect(agentRuntime.getRun("run-multi")?.reviewed).toBe(false);

    const journalStore = await import("@emther/core/journal-store");
    expect(journalStore.getCurrentJournalEntry("j-sib")?.resolvedIssueId).toBeUndefined();
  });

  it("agentRunIdを渡さない場合はLead Agentの分析Runを自動で起動し、Issueに紐づける", async () => {
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request("/", post({ title: "Journal起点のIssue", why: "本文" }));
    const json = await res.json();

    const agentRuntime = await import("@emther/core/agent-runtime/index");
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
    const agentRuntime = await import("@emther/core/agent-runtime/index");
    vi.spyOn(agentRuntime, "startRun").mockRejectedValueOnce(new Error("起動失敗"));

    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request("/", post({ title: "起動失敗しても作られるIssue" }));
    expect(res.status).toBe(201);
    expect((await res.json()).issue.title).toBe("起動失敗しても作られるIssue");
  });
});

describe("GET /api/issues/:id", () => {
  it("存在しないIDは404", async () => {
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request("/missing");
    expect(res.status).toBe(404);
  });

  it("存在すれば実名復元済みで返す", async () => {
    const issueStore = await import("@emther/core/issue-store");
    const issue = await issueStore.createIssue("既存Issue");
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request(`/${issue.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).issue.title).toBe("既存Issue");
  });

  it("先頭8桁の一意プレフィックスでも取得できる", async () => {
    const issueStore = await import("@emther/core/issue-store");
    const issue = await issueStore.createIssue("短いID");
    const { issuesRoute } = await import("./issues");
    const prefix = issue.id.slice(0, 8);
    const res = await issuesRoute.request(`/${prefix}`);
    expect(res.status).toBe(200);
    expect((await res.json()).issue.id).toBe(issue.id);
  });

  it("sourceJournalsにresolvedIssueIdで紐づくJournalを含める", async () => {
    const issueStore = await import("@emther/core/issue-store");
    const journalStore = await import("@emther/core/journal-store");
    const issue = await issueStore.createIssue("既存Issue");
    const entry = await journalStore.addJournalEntry("現場の問題");
    await journalStore.updateJournalEntry(entry.id, { resolvedIssueId: issue.id });
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request(`/${issue.id}`);
    const json = await res.json();
    expect(json.sourceJournals).toHaveLength(1);
    expect(json.sourceJournals[0].rawText).toBe("現場の問題");
  });
});

describe("PATCH /api/issues/:id", () => {
  it("存在しないIDは404", async () => {
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request("/missing", patch({ why: "x" }));
    expect(res.status).toBe(404);
  });

  it("titleを空文字にしようとすると400", async () => {
    const issueStore = await import("@emther/core/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request(`/${issue.id}`, patch({ title: "  " }));
    expect(res.status).toBe(400);
  });

  it("charter/title/keyResultId/teamIdをまとめて更新できる（charterはメモへ写像）", async () => {
    const issueStore = await import("@emther/core/issue-store");
    const issue = await issueStore.createIssue("元のタイトル");
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request(
      `/${issue.id}`,
      patch({ title: "新しいタイトル", why: "理由", tags: ["技術的負債"], keyResultId: "kr-1", teamId: "team-1" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.issue.title).toBe("新しいタイトル");
    expect(json.issue.logEntries.some((e: { text: string }) => e.text.includes("理由"))).toBe(true);
    expect(json.issue.keyResultId).toBe("kr-1");
    expect(json.issue.teamId).toBe("team-1");
  });

  it("statusを更新できる", async () => {
    const issueStore = await import("@emther/core/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request(`/${issue.id}`, patch({ status: "blocked" }));
    expect(res.status).toBe(200);
    expect((await res.json()).issue.status).toBe("blocked");
  });

  it("不正なstatusは400", async () => {
    const issueStore = await import("@emther/core/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request(`/${issue.id}`, patch({ status: "unknown" }));
    expect(res.status).toBe(400);
  });

  it("priorityとmoveFocusを更新できる", async () => {
    const issueStore = await import("@emther/core/issue-store");
    const a = await issueStore.createIssue("A");
    const b = await issueStore.createIssue("B");
    const { issuesRoute } = await import("./issues");
    const resA = await issuesRoute.request(`/${a.id}`, patch({ priority: "focus" }));
    expect(resA.status).toBe(200);
    expect((await resA.json()).issue.priority).toBe("focus");
    await issuesRoute.request(`/${b.id}`, patch({ priority: "focus" }));
    const moved = await issuesRoute.request(`/${b.id}`, patch({ moveFocus: "up" }));
    expect(moved.status).toBe(200);
    expect((await moved.json()).issue.focusOrder).toBe(0);
  });

  it("不正なpriorityは400", async () => {
    const issueStore = await import("@emther/core/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const { issuesRoute } = await import("./issues");
    const res = await issuesRoute.request(`/${issue.id}`, patch({ priority: "urgent" }));
    expect(res.status).toBe(400);
  });

  it("keyResultId/teamIdにnullを渡すと解除できる（キー自体が無ければ変更しない）", async () => {
    const issueStore = await import("@emther/core/issue-store");
    const issue = await issueStore.createIssue("Issue");
    issueStore.setIssueKeyResult(issue.id, "kr-1");
    issueStore.setIssueTeam(issue.id, "team-1");
    const { issuesRoute } = await import("./issues");

    const untouched = await issuesRoute.request(`/${issue.id}`, patch({}));
    expect((await untouched.json()).issue.keyResultId).toBe("kr-1");

    const cleared = await issuesRoute.request(`/${issue.id}`, patch({ keyResultId: null, teamId: null }));
    const json = await cleared.json();
    expect(json.issue.keyResultId).toBeUndefined();
    expect(json.issue.teamId).toBeUndefined();
  });
});

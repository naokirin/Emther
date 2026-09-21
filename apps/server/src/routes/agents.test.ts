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
    suggested_sub_suggestions_json: null,
    suggested_charter_json: null,
    suggested_themes_json: null,
    suggested_suggestion_notes_json: null,
    suggested_suggestion_updates_json: null,
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
      (id, agent_name, task, status, session_id, agy_conversation_id, cursor_session_id, yield_request_json, proposal_json, suggested_action_items_json, suggested_sub_suggestions_json, suggested_charter_json, suggested_themes_json, suggested_suggestion_notes_json, suggested_suggestion_updates_json, total_cost_usd, created_at, updated_at, consulted_by, origin, reviewed, triage_status, triage_at)
     VALUES (@id, @agent_name, @task, @status, @session_id, @agy_conversation_id, @cursor_session_id, @yield_request_json, @proposal_json, @suggested_action_items_json, @suggested_sub_suggestions_json, @suggested_charter_json, @suggested_themes_json, @suggested_suggestion_notes_json, @suggested_suggestion_updates_json, @total_cost_usd, @created_at, @updated_at, @consulted_by, @origin, @reviewed, @triage_status, @triage_at)`,
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

function del(body?: unknown) {
  return body === undefined
    ? { method: "DELETE" }
    : { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("GET /api/agents/:id", () => {
  it("存在しないIDは404", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/missing");
    expect(res.status).toBe(404);
  });

  it("存在すれば実名復元済みで返す", async () => {
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), { task: "PERSON_1についてのタスク" });
    const peopleDirectory = await import("@emther/core/people-directory");
    peopleDirectory.registerName("Aさん"); // PERSON_1として登録
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1");
    expect(res.status).toBe(200);
    expect((await res.json()).run.task).toBe("Aさんについてのタスク");
  });
});

describe("POST /api/agents/:id/decide", () => {
  it("messageが無ければ400", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/decide", post({ message: "  " }));
    expect(res.status).toBe(400);
  });

  it("存在しないIDは404", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/missing/decide", post({ message: "続けて" }));
    expect(res.status).toBe(404);
  });

  it("実行中(active)のrunへは409を返す", async () => {
    // loadRunsFromDb()はDBから読み込んだ"active"行を（サーバー再起動想定で）"error"に
    // 変換してしまうため、DB直接投入では真にactiveな状態を再現できない。実際にstartRunで
    // 起動し、spawnしたCLIプロセスをcloseさせないことで本物のactive状態を作る。
    const agentRuntime = await import("@emther/core/agent-runtime/index");
    const run = await agentRuntime.startRun("Lead Agent", "実行中のタスク");
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request(`/${run.id}/decide`, post({ message: "続けて" }));
    expect(res.status).toBe(409);
  });

  it("idle状態のrunを再開できる", async () => {
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb());
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/decide", post({ message: "続けて" }));
    expect(res.status).toBe(200);
    expect((await res.json()).run.status).toBe("active");
  });
});

describe("POST /api/agents/:id/review", () => {
  it("存在しないIDは404", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/missing/review", post({}));
    expect(res.status).toBe(404);
  });

  it("triageStatus未指定ならreviewedをtrueにする", async () => {
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), { origin: "auto-anomaly", reviewed: 0 });
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/review", post({}));
    const json = await res.json();
    expect(json.run.reviewed).toBe(true);
    expect(json.run.triageStatus).toBeUndefined();
  });

  it("triageStatus:watching/dismissedを設定できる", async () => {
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), { origin: "auto-anomaly", reviewed: 0 });
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/review", post({ triageStatus: "watching" }));
    expect((await res.json()).run.triageStatus).toBe("watching");
  });

  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。
  it("archived:trueでアーカイブし、falseで解除できる（reviewedは強制しない）", async () => {
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), { origin: "auto-anomaly", reviewed: 0 });
    const { agentsRoute } = await import("./agents");
    const archiveRes = await agentsRoute.request("/run-1/review", post({ archived: true }));
    const archived = await archiveRes.json();
    expect(archived.run.archivedAt).toBeTypeOf("number");
    expect(archived.run.reviewed).toBe(false);

    const unarchiveRes = await agentsRoute.request("/run-1/review", post({ archived: false }));
    expect((await unarchiveRes.json()).run.archivedAt).toBeUndefined();
  });

  it("archivedが真偽値でない場合は400", async () => {
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), { origin: "auto-anomaly", reviewed: 0 });
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/review", post({ archived: "yes" }));
    expect(res.status).toBe(400);
  });
});

describe("POST/DELETE /api/agents/:id/themes", () => {
  it("存在しないIDは404", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/missing/themes", post({}));
    expect(res.status).toBe(404);
  });

  it("採用できるテーマ提案が無ければ400", async () => {
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb());
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/themes", post({}));
    expect(res.status).toBe(400);
  });

  it("採用するとcandidateなOrgThemeが作られ、runから提案が消える", async () => {
    const { getDb } = await import("@emther/core/db");
    const suggested = [{ title: "テーマ案", summary: "要約", rationale: "根拠", facts: [] }];
    insertRunRow(getDb(), { suggested_themes_json: JSON.stringify(suggested) });
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/themes", post({}));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.themes).toHaveLength(1);
    expect(json.themes[0].title).toBe("テーマ案");
    expect(json.run.suggestedThemes).toBeUndefined();
  });

  it("DELETEで提案を却下できる", async () => {
    const { getDb } = await import("@emther/core/db");
    const suggested = [{ title: "テーマ案", summary: "要約", rationale: "根拠", facts: [] }];
    insertRunRow(getDb(), { suggested_themes_json: JSON.stringify(suggested) });
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/themes", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await res.json()).run.suggestedThemes).toBeUndefined();
  });
});

describe("POST/DELETE /api/agents/:id/suggestion-updates", () => {
  it("対象Suggestionへ変更を反映し、差分を消す", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案");
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), {
      suggested_suggestion_updates_json: JSON.stringify([
        { suggestionId: suggestion.id, reviewStatus: "done", reason: "対応済みのため" },
      ]),
    });
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/suggestion-updates", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.applied).toEqual([{ suggestionId: suggestion.id, reason: "対応済みのため" }]);
    expect(json.run.suggestedSuggestionUpdates).toBeUndefined();
    expect(suggestionStore.getSuggestion(suggestion.id)?.reviewStatus).toBe("done");
  });

  it("差分が無ければ400", async () => {
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb());
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/suggestion-updates", { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("runが無ければ404", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/missing/suggestion-updates", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("indicesを指定すると選んだ差分だけを反映し、残りは差分のまま残す", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const suggestionA = await suggestionStore.createSuggestion("対象提案A");
    const suggestionB = await suggestionStore.createSuggestion("対象提案B");
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), {
      suggested_suggestion_updates_json: JSON.stringify([
        { suggestionId: suggestionA.id, reviewStatus: "done", reason: "Aの理由" },
        { suggestionId: suggestionB.id, reviewStatus: "done", reason: "Bの理由" },
      ]),
    });
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/suggestion-updates", post({ indices: [0] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.applied).toEqual([{ suggestionId: suggestionA.id, reason: "Aの理由" }]);
    expect(json.run.suggestedSuggestionUpdates).toEqual([{ suggestionId: suggestionB.id, reviewStatus: "done", reason: "Bの理由" }]);
    expect(suggestionStore.getSuggestion(suggestionA.id)?.reviewStatus).toBe("done");
    expect(suggestionStore.getSuggestion(suggestionB.id)?.reviewStatus).toBe("unreviewed");
  });

  it("DELETEで差分を却下できる（Suggestion本体は変更しない）", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案");
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), {
      suggested_suggestion_updates_json: JSON.stringify([
        { suggestionId: suggestion.id, reviewStatus: "done", reason: "対応済みのため" },
      ]),
    });
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/suggestion-updates", del());
    expect(res.status).toBe(200);
    expect((await res.json()).run.suggestedSuggestionUpdates).toBeUndefined();
    expect(suggestionStore.getSuggestion(suggestion.id)?.reviewStatus).toBe("unreviewed");
  });
});

describe("POST/DELETE /api/agents/:id/suggestion-notes", () => {
  it("対象提案のメモへ追記し、提案を消す", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案");
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), { suggested_suggestion_notes_json: JSON.stringify([{ suggestionId: suggestion.id, text: "見つけた事実" }]) });
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/suggestion-notes", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.written).toEqual([{ suggestionId: suggestion.id, text: "見つけた事実" }]);
    expect(json.run.suggestedSuggestionNotes).toBeUndefined();
    expect(suggestionStore.getSuggestion(suggestion.id)?.memos.map((m) => m.text)).toEqual(["見つけた事実"]);
  });

  it("提案が無ければ400", async () => {
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb());
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/suggestion-notes", { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("runが無ければ404", async () => {
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/missing/suggestion-notes", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("DELETEで提案を却下できる", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案");
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), { suggested_suggestion_notes_json: JSON.stringify([{ suggestionId: suggestion.id, text: "見つけた事実" }]) });
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/suggestion-notes", del());
    expect(res.status).toBe(200);
    expect((await res.json()).run.suggestedSuggestionNotes).toBeUndefined();
    expect(suggestionStore.getSuggestion(suggestion.id)?.memos).toEqual([]);
  });

  it("reason:handledだと対応済みとしてrunログに残した上で提案を消す", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案");
    const { getDb } = await import("@emther/core/db");
    insertRunRow(getDb(), { suggested_suggestion_notes_json: JSON.stringify([{ suggestionId: suggestion.id, text: "見つけた事実" }]) });
    const { agentsRoute } = await import("./agents");
    const res = await agentsRoute.request("/run-1/suggestion-notes", del({ reason: "handled" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.run.suggestedSuggestionNotes).toBeUndefined();
    expect(json.run.log.some((l: { text: string }) => l.text.includes("対応済み"))).toBe(true);
  });
});

describe("POST /api/agents/pending-unmasked/:id", () => {
  it("dismissアクション: 存在しないIDは404", async () => {
    const { agentsPendingUnmaskedRoute } = await import("./agents");
    const res = await agentsPendingUnmaskedRoute.request("/missing", post({ action: "dismiss" }));
    expect(res.status).toBe(404);
  });

  it("confirmアクション（既定）: 存在しないIDは404", async () => {
    const { agentsPendingUnmaskedRoute } = await import("./agents");
    const res = await agentsPendingUnmaskedRoute.request("/missing", post({}));
    expect(res.status).toBe(404);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

vi.mock("@emther/core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@emther/core/name-candidate-detect", () => ({
  detectNameCandidatesAsync: async () => [] as string[],
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
}));

vi.mock("@emther/core/embeddings", () => ({
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

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function patch(body: unknown) {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function insertRun(id: string, reviewed = 0) {
  const { getDb } = await import("@emther/core/db");
  getDb()
    .prepare(
      `INSERT INTO agent_runs
        (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, "Lead Agent", "方針を相談したい", "idle", 0, 1, 1, "manual", reviewed);
}

async function insertRunWithProposal(id: string, proposal: Record<string, unknown> | null) {
  const { getDb } = await import("@emther/core/db");
  getDb()
    .prepare(
      `INSERT INTO agent_runs
        (id, agent_name, task, status, proposal_json, total_cost_usd, created_at, updated_at, origin, reviewed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, "Lead Agent", "方針を相談したい", "idle", proposal ? JSON.stringify(proposal) : null, 0, 1, 1, "manual", 0);
}

describe("GET /api/suggestions", () => {
  it("一覧を実名復元済みで返す", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const suggestionStore = await import("@emther/core/suggestion-store");
    peopleDirectory.registerName("Aさん");
    await suggestionStore.createSuggestion("Aさんの育成計画");

    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.suggestions).toHaveLength(1);
    expect(json.suggestions[0].title).toBe("Aさんの育成計画");
  });
});

describe("POST /api/suggestions", () => {
  it("titleが無ければ400を返す", async () => {
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/", post({ title: "  " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("titleは必須です");
  });

  it("bodyがJSONでなくても400として扱う（クラッシュしない）", async () => {
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/", { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
  });

  it("最小限の入力で201を返す", async () => {
    const runtime = await import("@emther/core/agent-runtime/index");
    vi.spyOn(runtime, "startRun").mockResolvedValue({
      id: "run-min",
      agentName: "Lead Agent",
      task: "x",
      status: "active",
      log: [],
      totalCostUsd: 0,
      createdAt: 1,
      updatedAt: 1,
      origin: "manual",
      reviewed: true,
    });
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/", post({ title: "新しい提案" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.suggestion.title).toBe("新しい提案");
  });

  it("why/what/howを渡すとメモへ折り込まれ、teamIdも反映される", async () => {
    const runtime = await import("@emther/core/agent-runtime/index");
    vi.spyOn(runtime, "startRun").mockResolvedValue({
      id: "run-charter",
      agentName: "Lead Agent",
      task: "x",
      status: "active",
      log: [],
      totalCostUsd: 0,
      createdAt: 1,
      updatedAt: 1,
      origin: "manual",
      reviewed: true,
    });
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(
      "/",
      post({ title: "詳細付き提案", why: "理由", what: "内容", how: "方法", teamId: "team-1" }),
    );
    const json = await res.json();
    expect(json.suggestion.title).toBe("詳細付き提案");
    expect(json.suggestion.memos.some((m: { text: string }) => m.text.includes("Why: 理由"))).toBe(true);
    expect(json.suggestion.memos.find((m: { text: string; source?: string }) => m.text.includes("Why: 理由"))?.source).toBe("agent");
    expect(json.suggestion.teamId).toBe("team-1");
  });

  it("agentRunIdを渡すとそのrunをreviewed済みにし、新規分析Runは起動しない", async () => {
    await insertRun("run-1", 0);
    const agentRuntime = await import("@emther/core/agent-runtime/index");
    const startSpy = vi.spyOn(agentRuntime, "startRun");
    expect(agentRuntime.getRun("run-1")?.reviewed).toBe(false);

    const { suggestionsRoute } = await import("./suggestions");
    await suggestionsRoute.request("/", post({ title: "AI起点の提案", agentRunId: "run-1" }));
    expect(agentRuntime.getRun("run-1")?.reviewed).toBe(true);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("相談のrunにsourceJournalIdがあれば提案へコピーしJournalも紐付ける", async () => {
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
    await insertRun("run-src", 0);
    const { getDb } = await import("@emther/core/db");
    getDb().prepare("UPDATE agent_runs SET source_journal_id = ? WHERE id = ?").run("j-fixed", "run-src");

    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/", post({ title: "AI起点の提案", agentRunId: "run-src" }));
    const json = await res.json();
    expect(json.suggestion.sourceJournalId).toBe("j-fixed");
    expect(json.suggestion.sourceRunId).toBe("run-src");

    const journalStore = await import("@emther/core/journal-store");
    expect(journalStore.getCurrentJournalEntry("j-fixed")?.resolvedSuggestionId).toBe(json.suggestion.id);
  });

  it("AIチームの分析起動に失敗しても提案の起票自体は成功する", async () => {
    const agentRuntime = await import("@emther/core/agent-runtime/index");
    vi.spyOn(agentRuntime, "startRun").mockRejectedValueOnce(new Error("起動失敗"));

    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/", post({ title: "起動失敗しても作られる提案" }));
    expect(res.status).toBe(201);
    expect((await res.json()).suggestion.title).toBe("起動失敗しても作られる提案");
  });

  it("sourceRunIdのみのときは相談を吸収せず、新規分析Runも起動しない", async () => {
    await insertRun("run-consult", 0);
    const runtime = await import("@emther/core/agent-runtime/index");
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
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/", post({ title: "分割提案A", sourceRunId: "run-consult" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.suggestion.sourceRunId).toBe("run-consult");
    expect(json.suggestion.agentRunId).toBeUndefined();
    expect(startSpy).not.toHaveBeenCalled();
    expect(runtime.getRun("run-consult")?.reviewed).toBe(true);
    startSpy.mockRestore();
  });

  it("agentRunIdもsourceRunIdも無いときは分析Runを起動する", async () => {
    const runtime = await import("@emther/core/agent-runtime/index");
    const startSpy = vi.spyOn(runtime, "startRun").mockResolvedValue({
      id: "run-new",
      agentName: "Lead Agent",
      task: "新しい提案が起票されました",
      status: "active",
      log: [],
      totalCostUsd: 0,
      createdAt: 1,
      updatedAt: 1,
      origin: "manual",
      reviewed: true,
    });
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/", post({ title: "Journalから提案" }));
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
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/", post({ title: "詳細つき提案", sourceRunId: "run-with-proposal" }));
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
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/", post({ title: "詳細なし提案", sourceRunId: "run-no-proposal" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.suggestion.detail).toBeUndefined();
  });
});

// docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。
describe("PATCH /api/suggestions/:id archived", () => {
  it("archived:trueでアーカイブし、falseで解除できる", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("重複した提案");
    const { suggestionsRoute } = await import("./suggestions");

    const archiveRes = await suggestionsRoute.request(`/${s.id}`, patch({ archived: true }));
    expect(archiveRes.status).toBe(200);
    const archiveJson = await archiveRes.json();
    expect(archiveJson.suggestion.archivedAt).toBeTypeOf("number");
    expect(archiveJson.suggestion.reviewStatus).toBe("unreviewed");

    const unarchiveRes = await suggestionsRoute.request(`/${s.id}`, patch({ archived: false }));
    expect(unarchiveRes.status).toBe(200);
    const unarchiveJson = await unarchiveRes.json();
    expect(unarchiveJson.suggestion.archivedAt).toBeUndefined();
  });

  it("archivedが真偽値でない場合は400", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("テスト用の提案");
    const { suggestionsRoute } = await import("./suggestions");

    const res = await suggestionsRoute.request(`/${s.id}`, patch({ archived: "yes" }));
    expect(res.status).toBe(400);
  });
});

// ユーザー要望「後回しにする場合でも『いつまでには確認したい』という期日を入力したい」対応。
describe("PATCH /api/suggestions/:id reviewDueAt", () => {
  it("reviewDueAtを設定・null で解除できる", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("期日をつけたい提案");
    const { suggestionsRoute } = await import("./suggestions");

    const setRes = await suggestionsRoute.request(`/${s.id}`, patch({ reviewDueAt: 123456 }));
    expect(setRes.status).toBe(200);
    expect((await setRes.json()).suggestion.reviewDueAt).toBe(123456);

    const clearRes = await suggestionsRoute.request(`/${s.id}`, patch({ reviewDueAt: null }));
    expect(clearRes.status).toBe(200);
    expect((await clearRes.json()).suggestion.reviewDueAt).toBeUndefined();
  });

  it("reviewDueAtが数値でもnullでもない場合は400", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("テスト用の提案");
    const { suggestionsRoute } = await import("./suggestions");

    const res = await suggestionsRoute.request(`/${s.id}`, patch({ reviewDueAt: "2026-09-20" }));
    expect(res.status).toBe(400);
  });
});

// ユーザー要望「確認状態に『確認中』ステータスを追加したい」対応。
describe("PATCH /api/suggestions/:id reviewStatus=in_review", () => {
  it("確認中(in_review)へ変更できる", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("検討中の提案");
    const { suggestionsRoute } = await import("./suggestions");

    const res = await suggestionsRoute.request(`/${s.id}`, patch({ reviewStatus: "in_review" }));
    expect(res.status).toBe(200);
    expect((await res.json()).suggestion.reviewStatus).toBe("in_review");
  });
});

describe("PATCH /api/suggestions/:id title/charter/teamId", () => {
  it("存在しないIDは404", async () => {
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/missing", patch({ why: "x" }));
    expect(res.status).toBe(404);
  });

  it("titleを空文字にしようとすると400", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("提案");
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(`/${s.id}`, patch({ title: "  " }));
    expect(res.status).toBe(400);
  });

  it("why/title/teamIdをまとめて更新できる（why/what/howはメモへ写像）", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("元のタイトル");
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(
      `/${s.id}`,
      patch({ title: "新しいタイトル", why: "理由", teamId: "team-1" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.suggestion.title).toBe("新しいタイトル");
    expect(json.suggestion.memos.some((m: { text: string }) => m.text.includes("理由"))).toBe(true);
    expect(json.suggestion.teamId).toBe("team-1");
  });

  it("confirmPriorityとmoveFocusを更新できる", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const a = await suggestionStore.createSuggestion("A");
    const b = await suggestionStore.createSuggestion("B");
    const { suggestionsRoute } = await import("./suggestions");
    const resA = await suggestionsRoute.request(`/${a.id}`, patch({ confirmPriority: "focus" }));
    expect(resA.status).toBe(200);
    expect((await resA.json()).suggestion.confirmPriority).toBe("focus");
    await suggestionsRoute.request(`/${b.id}`, patch({ confirmPriority: "focus" }));
    const moved = await suggestionsRoute.request(`/${b.id}`, patch({ moveFocus: "up" }));
    expect(moved.status).toBe(200);
    expect((await moved.json()).suggestion.focusOrder).toBe(0);
  });

  it("不正なconfirmPriorityは400", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("提案");
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(`/${s.id}`, patch({ confirmPriority: "urgent" }));
    expect(res.status).toBe(400);
  });

  it("teamIdにnullを渡すと解除できる（キー自体が無ければ変更しない）", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("提案");
    suggestionStore.setSuggestionTeam(s.id, "team-1");
    const { suggestionsRoute } = await import("./suggestions");

    const untouched = await suggestionsRoute.request(`/${s.id}`, patch({}));
    expect((await untouched.json()).suggestion.teamId).toBe("team-1");

    const cleared = await suggestionsRoute.request(`/${s.id}`, patch({ teamId: null }));
    const json = await cleared.json();
    expect(json.suggestion.teamId).toBeUndefined();
  });
});

// docs/memo.md「メモとは別に提案自体の詳細を残す単一の場所」対応。
describe("PATCH /api/suggestions/:id refreshDetailFromRunId", () => {
  it("指定Runの現在のproposalで詳細を更新する", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("詳細を更新する提案");
    await insertRunWithProposal("run-updated", {
      conclusion: "新しい結論",
      facts: [],
      logic: "新しいロジック",
      rejectedAlternatives: [],
      expansions: [],
      challenges: [],
    });
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(`/${s.id}`, patch({ refreshDetailFromRunId: "run-updated" }));
    expect(res.status).toBe(200);
    expect((await res.json()).suggestion.detail?.conclusion).toBe("新しい結論");
  });

  it("proposalが無いRunを指定すると400になる", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("詳細を更新できない提案");
    await insertRunWithProposal("run-empty", null);
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(`/${s.id}`, patch({ refreshDetailFromRunId: "run-empty" }));
    expect(res.status).toBe(400);
  });
});

// ユーザー要望「提案の詳細をユーザーでも編集したい」対応。
describe("PATCH /api/suggestions/:id detail", () => {
  it("EMが詳細を新規に書き起こせる", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("EM編集の提案");
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(
      `/${s.id}`,
      patch({ detail: { conclusion: "EMの結論", facts: ["事実A"], logic: "EMのロジック", advice: "EMの助言" } }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.suggestion.detail.conclusion).toBe("EMの結論");
    expect(json.suggestion.detail.facts).toEqual(["事実A"]);
    expect(json.suggestion.detail.advice).toBe("EMの助言");
  });

  it("conclusion/logicを空にする更新は400になる", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("空にできない提案", { detail: { conclusion: "結論", facts: [], logic: "ロジック" } });
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(`/${s.id}`, patch({ detail: { conclusion: "" } }));
    expect(res.status).toBe(400);
  });

  it("detail.factsが文字列配列でなければ400になる", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("不正なfactsの提案");
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(`/${s.id}`, patch({ detail: { facts: [1, 2] } }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/suggestions/:id", () => {
  it("存在しないIDは404", async () => {
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/missing");
    expect(res.status).toBe(404);
  });

  it("存在すれば実名復元済みで返す", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("既存提案");
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(`/${s.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).suggestion.title).toBe("既存提案");
  });

  it("先頭8桁の一意プレフィックスでも取得できる", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("短いID");
    const { suggestionsRoute } = await import("./suggestions");
    const prefix = s.id.slice(0, 8);
    const res = await suggestionsRoute.request(`/${prefix}`);
    expect(res.status).toBe(200);
    expect((await res.json()).suggestion.id).toBe(s.id);
  });

  it("sourceJournalsにresolvedSuggestionIdで紐づくJournalを含める", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const journalStore = await import("@emther/core/journal-store");
    const s = await suggestionStore.createSuggestion("既存提案");
    const entry = await journalStore.addJournalEntry("現場の問題");
    await journalStore.updateJournalEntry(entry.id, { resolvedSuggestionId: s.id });
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(`/${s.id}`);
    const json = await res.json();
    expect(json.sourceJournals).toHaveLength(1);
    expect(json.sourceJournals[0].rawText).toBe("現場の問題");
  });
});

describe("POST /api/suggestions/:id/memo", () => {
  it("textが無ければ400", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("対象提案");
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(`/${s.id}/memo`, post({ text: "  " }));
    expect(res.status).toBe(400);
  });

  it("runが無ければ404", async () => {
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request("/missing/memo", post({ text: "メモ" }));
    expect(res.status).toBe(404);
  });

  it("メモを追加できる（201）", async () => {
    const suggestionStore = await import("@emther/core/suggestion-store");
    const s = await suggestionStore.createSuggestion("対象提案");
    const { suggestionsRoute } = await import("./suggestions");
    const res = await suggestionsRoute.request(`/${s.id}/memo`, post({ text: "追記メモ" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.suggestion.memos.some((m: { text: string }) => m.text.includes("追記メモ"))).toBe(true);
    expect(json.suggestion.memos.find((m: { text: string; source?: string }) => m.text.includes("追記メモ"))?.source).toBe("user");
    // body の source を偽っても user 固定
    const res2 = await suggestionsRoute.request(`/${s.id}/memo`, post({ text: "もう一件", source: "agent" }));
    expect(res2.status).toBe(201);
    const json2 = await res2.json();
    expect(json2.suggestion.memos.find((m: { text: string; source?: string }) => m.text.includes("もう一件"))?.source).toBe("user");
  });
});

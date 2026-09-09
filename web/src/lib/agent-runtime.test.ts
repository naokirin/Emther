import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

// agent-runtime.tsの「純粋なパース関数」「プロンプト組み立て関数」「DBへ直接rowを仕込むことで
// 実プロセスを起動せずに検証できるrun一覧・状態遷移系の関数」は上のdescribeブロック群でカバー
// 済み。ここから下は、実際にCLI子プロセスを起動するstartRun/decideRun/runClaudeTurn（claude→agy→
// cursor-agentのフォールバック連鎖）と、Lead Agentのconsult協働ループ（handleConsult）を対象に、
// node:child_processのspawnを丸ごとモックして検証する。
vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

// vi.mockのファクトリはファイル先頭へホイストされるため、テストごとに差し替えたい実装は
// vi.hoisted()で作った可変の参照（spawnRef.impl）越しに間接呼び出しする。実装の中身
// （FakeChildProcess等）は通常のimportが揃った後の、このファイルの下の方で定義してよい。
const spawnRef = vi.hoisted(() => ({
  impl: (() => {
    throw new Error("spawn is not mocked for this test");
  }) as (command: string, args: string[]) => unknown,
}));
vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[]) => spawnRef.impl(command, args),
}));

// claude/agy/cursor-agentいずれも「stdout/stderrへstream-json形式のNDJSONを流し、
// 終了時にcloseイベントを出す」という同じ形のChildProcessとして扱えるため、共通の
// フェイクで代用する（イベント構造の実装差はstdout/stderrの読み取り側=agent-runtime.ts側にある）。
class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

type SpawnCall = { command: string; args: string[]; child: FakeChildProcess };
let spawnCalls: SpawnCall[] = [];

function setupSpawnMock(): void {
  spawnCalls = [];
  spawnRef.impl = (command: string, args: string[]) => {
    const child = new FakeChildProcess();
    spawnCalls.push({ command, args, child });
    return child;
  };
}

function emitLine(child: FakeChildProcess, payload: unknown): void {
  child.stdout.emit("data", Buffer.from(`${JSON.stringify(payload)}\n`));
}

function emitAssistantText(child: FakeChildProcess, text: string): void {
  emitLine(child, { type: "assistant", message: { content: [{ type: "text", text }] } });
}

function emitClaudeResult(
  child: FakeChildProcess,
  opts: { text?: string; sessionId?: string; costUsd?: number; isError?: boolean } = {},
): void {
  emitLine(child, {
    type: "result",
    session_id: opts.sessionId,
    total_cost_usd: opts.costUsd ?? 0.01,
    is_error: opts.isError ?? false,
    result: opts.text ?? "",
  });
}

function emitAgyResult(
  child: FakeChildProcess,
  opts: { status?: string; text?: string; conversationId?: string } = {},
): void {
  emitLine(child, {
    event: "result",
    result: { status: opts.status ?? "SUCCESS", response: opts.text, conversation_id: opts.conversationId },
  });
}

function emitCursorResult(
  child: FakeChildProcess,
  opts: { sessionId?: string; isError?: boolean; text?: string } = {},
): void {
  emitLine(child, { type: "result", session_id: opts.sessionId, is_error: opts.isError ?? false, result: opts.text ?? "" });
}

function closeChild(child: FakeChildProcess, code = 0): void {
  child.emit("close", code);
}

async function waitForSpawnCount(n: number): Promise<void> {
  await vi.waitFor(() => {
    if (spawnCalls.length < n) throw new Error(`spawn call count ${spawnCalls.length} < ${n}`);
  });
}

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  setupSpawnMock();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModule() {
  return import("@/lib/agent-runtime");
}

describe("extractYield / extractProposal / extractActionItems / extractSubIssues / extractConsult", () => {
  it("extractYieldはfenced yieldブロックをパースする", async () => {
    const rt = await loadModule();
    const text = [
      "説明文です。",
      "```yield",
      '{ "reason": "情報不足", "options": [{ "id": "A", "label": "選択肢A" }] }',
      "```",
    ].join("\n");
    expect(rt.extractYield(text)).toEqual({
      reason: "情報不足",
      options: [{ id: "A", label: "選択肢A" }],
      kind: "decide",
    });
  });

  it("extractYieldはoptionsが無ければ空配列にフォールバックする", async () => {
    const rt = await loadModule();
    const text = '```yield\n{ "reason": "理由のみ" }\n```';
    expect(rt.extractYield(text)?.options).toEqual([]);
  });

  it("extractYieldはkindを明示的にパースする", async () => {
    const rt = await loadModule();
    const text = '```yield\n{ "reason": "介入の実行を決めてください", "kind": "commit", "options": [] }\n```';
    expect(rt.extractYield(text)?.kind).toBe("commit");
  });

  it("extractYieldはkind未指定の場合、options有無からdecide/informへフォールバックする", async () => {
    const rt = await loadModule();
    const withOptions = '```yield\n{ "reason": "選んでください", "options": [{ "id": "A", "label": "案A" }] }\n```';
    expect(rt.extractYield(withOptions)?.kind).toBe("decide");
    const withoutOptions = '```yield\n{ "reason": "情報が足りません", "options": [] }\n```';
    expect(rt.extractYield(withoutOptions)?.kind).toBe("inform");
  });

  it("extractYieldは未知のkind値を無視してフォールバックする", async () => {
    const rt = await loadModule();
    const text = '```yield\n{ "reason": "理由", "kind": "unknown-kind", "options": [] }\n```';
    expect(rt.extractYield(text)?.kind).toBe("inform");
  });

  it("extractYieldはyieldブロックが無ければundefined", async () => {
    const rt = await loadModule();
    expect(rt.extractYield("通常の文章のみ")).toBeUndefined();
  });

  it("extractYieldは不正なJSONの場合undefined", async () => {
    const rt = await loadModule();
    expect(rt.extractYield("```yield\n{ not valid json\n```")).toBeUndefined();
  });

  it("extractProposalはfenced proposalブロックをパースする", async () => {
    const rt = await loadModule();
    const text = [
      "```proposal",
      '{ "conclusion": "結論", "facts": ["fact1"], "logic": "ロジック", "rejectedAlternatives": [{ "option": "案B", "reason": "コスト大" }] }',
      "```",
    ].join("\n");
    expect(rt.extractProposal(text)).toEqual({
      conclusion: "結論",
      facts: ["fact1"],
      logic: "ロジック",
      rejectedAlternatives: [{ option: "案B", reason: "コスト大" }],
    });
  });

  it("extractProposalはconclusion/logicが文字列でなければundefined", async () => {
    const rt = await loadModule();
    expect(rt.extractProposal('```proposal\n{ "facts": [] }\n```')).toBeUndefined();
  });

  it("extractProposalはfacts/rejectedAlternativesが不正な要素を含む場合フィルタする", async () => {
    const rt = await loadModule();
    const text = '```proposal\n{ "conclusion": "c", "logic": "l", "facts": ["ok", 123], "rejectedAlternatives": ["bad", { "option": "ok" }] }\n```';
    const proposal = rt.extractProposal(text);
    expect(proposal?.facts).toEqual(["ok"]);
    expect(proposal?.rejectedAlternatives).toEqual([{ option: "ok" }]);
  });

  it("extractActionItemsは文字列配列をパースし、空文字列は除外する", async () => {
    const rt = await loadModule();
    const text = '```action_items\n["やること1", "", "やること2"]\n```';
    expect(rt.extractActionItems(text)).toEqual(["やること1", "やること2"]);
  });

  it("extractActionItemsは全項目が空/存在しない場合undefined", async () => {
    const rt = await loadModule();
    expect(rt.extractActionItems('```action_items\n[]\n```')).toBeUndefined();
    expect(rt.extractActionItems("ブロックなし")).toBeUndefined();
  });

  it("extractSubIssuesも同様にパースする", async () => {
    const rt = await loadModule();
    const text = '```sub_issues\n["子課題A", "子課題B"]\n```';
    expect(rt.extractSubIssues(text)).toEqual(["子課題A", "子課題B"]);
  });

  it("extractCharterはwhy/what/howのうち有効な値だけをパースする", async () => {
    const rt = await loadModule();
    const text = '```charter\n{ "why": "価値", "what": "", "how": 123 }\n```';
    expect(rt.extractCharter(text)).toEqual({ why: "価値" });
  });

  it("extractCharterは1件も有効な値が無ければundefined", async () => {
    const rt = await loadModule();
    expect(rt.extractCharter('```charter\n{ "what": "" }\n```')).toBeUndefined();
    expect(rt.extractCharter("ブロックなし")).toBeUndefined();
  });

  it("extractConsultはagents/questionをパースする", async () => {
    const rt = await loadModule();
    const text = '```consult\n{ "agents": ["People Agent", "Tech Agent"], "question": "共通質問" }\n```';
    expect(rt.extractConsult(text)).toEqual({ agents: ["People Agent", "Tech Agent"], question: "共通質問", questions: undefined });
  });

  it("extractConsultは不明なagent名・重複を除去する", async () => {
    const rt = await loadModule();
    const text = '```consult\n{ "agents": ["People Agent", "People Agent", "Unknown Agent"], "question": "q" }\n```';
    expect(rt.extractConsult(text)?.agents).toEqual(["People Agent"]);
  });

  it("extractConsultはagentsが空・全て不明な場合undefined", async () => {
    const rt = await loadModule();
    expect(rt.extractConsult('```consult\n{ "agents": ["Unknown Agent"], "question": "q" }\n```')).toBeUndefined();
    expect(rt.extractConsult('```consult\n{ "agents": [], "question": "q" }\n```')).toBeUndefined();
  });

  it("extractConsultは後方互換のagent(単数)フィールドも受け付ける", async () => {
    const rt = await loadModule();
    const text = '```consult\n{ "agent": "People Agent", "question": "q" }\n```';
    expect(rt.extractConsult(text)?.agents).toEqual(["People Agent"]);
  });

  it("extractConsultはagentsに含まれないquestionsのキーを無視する", async () => {
    const rt = await loadModule();
    const text = '```consult\n{ "agents": ["People Agent"], "question": "共通", "questions": { "People Agent": "個別質問", "Tech Agent": "含まれないので無視" } }\n```';
    expect(rt.extractConsult(text)?.questions).toEqual({ "People Agent": "個別質問" });
  });

  it("consultQuestionForは個別質問が無ければ共通questionにフォールバックする", async () => {
    const rt = await loadModule();
    const consult = { agents: ["People Agent", "Tech Agent"], question: "共通", questions: { "People Agent": "個別" } };
    expect(rt.consultQuestionFor(consult, "People Agent")).toBe("個別");
    expect(rt.consultQuestionFor(consult, "Tech Agent")).toBe("共通");
  });
});

describe("todayDateString", () => {
  it("YYYY-MM-DD形式にゼロ埋めする", async () => {
    const rt = await loadModule();
    expect(rt.todayDateString(new Date(2026, 0, 9))).toBe("2026-01-09");
  });
});

describe("isAgyFallbackEnabled / isCursorFallbackEnabled", () => {
  it("設定で明示的に有効化されたエージェントだけtrueを返す", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ agyFallbackAgents: ["Lead Agent"], cursorFallbackAgents: [] });
    const rt = await loadModule();
    expect(rt.isAgyFallbackEnabled("Lead Agent")).toBe(true);
    expect(rt.isAgyFallbackEnabled("People Agent")).toBe(false);
    expect(rt.isCursorFallbackEnabled("Lead Agent")).toBe(false);
  });

  it("既定では全エージェント無効", async () => {
    const rt = await loadModule();
    expect(rt.isAgyFallbackEnabled("Lead Agent")).toBe(false);
    expect(rt.isCursorFallbackEnabled("Lead Agent")).toBe(false);
  });
});

describe("relevantTeams", () => {
  const teamA = { id: "t1", name: "Engineering", members: [], charter: { mission: "", constraints: "" }, archived: false, createdAt: 0, updatedAt: 0 };
  const teamB = { id: "t2", name: "Sales", members: [], charter: { mission: "", constraints: "" }, archived: false, createdAt: 0, updatedAt: 0 };

  it("手がかりが無ければ全チームを返す", async () => {
    const rt = await loadModule();
    expect(rt.relevantTeams([teamA, teamB], undefined, undefined)).toEqual([teamA, teamB]);
  });

  it("rawTextにチーム名の言及があれば絞り込む", async () => {
    const rt = await loadModule();
    expect(rt.relevantTeams([teamA, teamB], undefined, "Engineeringの状況について")).toEqual([teamA]);
  });

  it("rawTextに何もヒットしなければ全チームにフォールバックする", async () => {
    const rt = await loadModule();
    expect(rt.relevantTeams([teamA, teamB], undefined, "無関係な文章")).toEqual([teamA, teamB]);
  });
});

describe("buildOrgContextBlock", () => {
  it("チームが無ければ空文字列", async () => {
    const rt = await loadModule();
    expect(rt.buildOrgContextBlock()).toBe("");
  });

  it("チームがあれば名簿を含める", async () => {
    const orgStore = await import("@/lib/org-context-store");
    orgStore.addTeam("Team A", ["Aさん"]);
    const rt = await loadModule();
    const block = rt.buildOrgContextBlock();
    expect(block).toContain("組織のチーム構成");
    expect(block).toContain("Team A");
  });
});

describe("buildStrategyBlock / buildObjectivesBlock", () => {
  it("MVVが未設定なら空文字列", async () => {
    const rt = await loadModule();
    expect(rt.buildStrategyBlock()).toBe("");
  });

  it("設定済みの項目だけ行として含める", async () => {
    const orgStore = await import("@/lib/org-context-store");
    await orgStore.updateOrgStrategy({ mission: "顧客に価値を届ける" });
    const rt = await loadModule();
    const block = rt.buildStrategyBlock();
    expect(block).toContain("Mission: 顧客に価値を届ける");
    expect(block).not.toContain("Vision:");
  });

  it("Objectiveが無ければ空文字列", async () => {
    const rt = await loadModule();
    expect(rt.buildObjectivesBlock("Lead Agent")).toBe("");
  });

  it("Product/Lead Agentには『判断の主軸』という強調文言になる", async () => {
    const orgStore = await import("@/lib/org-context-store");
    await orgStore.addObjective("売上を伸ばす");
    const rt = await loadModule();
    expect(rt.buildObjectivesBlock("Lead Agent")).toContain("判断の主軸としてください");
    expect(rt.buildObjectivesBlock("People Agent")).toContain("参考情報");
  });
});

describe("buildIssueContextBlock / buildTeamCharterBlock / buildInterventionTypeGuidance", () => {
  it("runIdに紐づくIssueが無ければ空文字列", async () => {
    const rt = await loadModule();
    expect(rt.buildIssueContextBlock("missing-run")).toBe("");
  });

  it("charterが全て空でtagsも無ければ空文字列", async () => {
    const issueStore = await import("@/lib/issue-store");
    await issueStore.createIssue("Issue", "run-1");
    const rt = await loadModule();
    expect(rt.buildIssueContextBlock("run-1")).toBe("");
  });

  it("charterが埋まっていればWhy/What/Howを含める", async () => {
    const issueStore = await import("@/lib/issue-store");
    await issueStore.createIssue("障害対応", "run-1", { why: "顧客影響を止める", what: "原因特定", how: "ログ調査" });
    const rt = await loadModule();
    const block = rt.buildIssueContextBlock("run-1");
    expect(block).toContain("タイトル: 障害対応");
    expect(block).toContain("Why（生む価値・誰のため・なぜ今か）: 顧客影響を止める");
    expect(block).toContain("How（どのように実現するか・前提や制約）: ログ調査");
  });

  it("Issueにチームが紐付いていなければteam charterは空文字列", async () => {
    const issueStore = await import("@/lib/issue-store");
    await issueStore.createIssue("Issue", "run-1");
    const rt = await loadModule();
    expect(rt.buildTeamCharterBlock("run-1")).toBe("");
  });

  it("チームのMission/制約が設定されていれば含める", async () => {
    const issueStore = await import("@/lib/issue-store");
    const orgStore = await import("@/lib/org-context-store");
    const team = orgStore.addTeam("Team A", []);
    await orgStore.updateTeam(team.id, { mission: "価値を届ける", constraints: "予算内で行う" });
    await issueStore.createIssue("Issue", "run-1", undefined, undefined, undefined, undefined, team.id);
    const rt = await loadModule();
    const block = rt.buildTeamCharterBlock("run-1");
    expect(block).toContain("Mission: 価値を届ける");
    expect(block).toContain("制約: 予算内で行う");
  });

  it("介入の型タグに応じて主担当/副担当のガイダンスを出し分ける", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("1on1改善", "run-1");
    issueStore.setIssueTags(issue.id, ["1on1設計"]);
    const rt = await loadModule();
    expect(rt.buildInterventionTypeGuidance("run-1", "People Agent")).toContain("主担当として");
    expect(rt.buildInterventionTypeGuidance("run-1", "Process Agent")).toContain("副担当のため");
    expect(rt.buildInterventionTypeGuidance("run-1", "Tech Agent")).toBe("");
  });

  it("runIdが無ければ空文字列", async () => {
    const rt = await loadModule();
    expect(rt.buildInterventionTypeGuidance(undefined, "People Agent")).toBe("");
  });
});

describe("buildSystemPrompt", () => {
  it("Lead Agent + allowConsult:trueの場合はconsultブロックの説明を含む", async () => {
    const rt = await loadModule();
    const prompt = rt.buildSystemPrompt("Lead Agent", true);
    expect(prompt).toContain("```consult");
  });

  it("allowConsult:falseの場合はconsultブロックの説明を含まない", async () => {
    const rt = await loadModule();
    const prompt = rt.buildSystemPrompt("Lead Agent", false);
    expect(prompt).not.toContain("```consult");
  });

  it("専門エージェントには専門外の情報不足時はyieldする旨のテールが付く", async () => {
    const rt = await loadModule();
    const prompt = rt.buildSystemPrompt("People Agent", false);
    expect(prompt).toContain("推測で埋めず、proposalではなくyieldしてください");
  });

  it("Issueに紐づくrunにはaction_itemsブロックの説明が付く", async () => {
    const issueStore = await import("@/lib/issue-store");
    await issueStore.createIssue("Issue", "run-1");
    const rt = await loadModule();
    const prompt = rt.buildSystemPrompt("Lead Agent", true, "run-1");
    expect(prompt).toContain("```action_items");
  });

  it("トップレベルIssueに紐づくrunにはsub_issuesブロックの説明が付く", async () => {
    const issueStore = await import("@/lib/issue-store");
    await issueStore.createIssue("トップレベルIssue", "run-1");
    const rt = await loadModule();
    expect(rt.buildSystemPrompt("Lead Agent", true, "run-1")).toContain("```sub_issues");
  });

  it("子Issueに紐づくrunにはsub_issuesブロックの説明が付かない（1階層制限）", async () => {
    const issueStore = await import("@/lib/issue-store");
    const parent = await issueStore.createIssue("親Issue");
    await issueStore.createIssue("子Issue", "run-1", undefined, parent.id);
    const rt = await loadModule();
    expect(rt.buildSystemPrompt("Lead Agent", true, "run-1")).not.toContain("```sub_issues");
  });

  it("Issueに紐づかないrunにはaction_items/sub_issuesの説明が付かない", async () => {
    const rt = await loadModule();
    const prompt = rt.buildSystemPrompt("Lead Agent", true, "run-without-issue");
    expect(prompt).not.toContain("```action_items");
    expect(prompt).not.toContain("```sub_issues");
  });

  it("Why/What/Howが未整理のIssueに紐づくrunにはcharterブロックの説明が付く（子Issueでも同様）", async () => {
    const issueStore = await import("@/lib/issue-store");
    const parent = await issueStore.createIssue("親Issue");
    await issueStore.createIssue("子Issue", "run-1", undefined, parent.id);
    const rt = await loadModule();
    const prompt = rt.buildSystemPrompt("Lead Agent", true, "run-1");
    expect(prompt).toContain("```charter");
    expect(prompt).toContain("why, what, how");
  });

  it("Why/What/Howが全て埋まっているIssueに紐づくrunにはcharterブロックの説明が付かない", async () => {
    const issueStore = await import("@/lib/issue-store");
    await issueStore.createIssue("Issue", "run-1", { why: "w1", what: "w2", how: "w3" });
    const rt = await loadModule();
    expect(rt.buildSystemPrompt("Lead Agent", true, "run-1")).not.toContain("```charter");
  });

  it("Issueに紐づかないrunにはcharterブロックの説明が付かない", async () => {
    const rt = await loadModule();
    expect(rt.buildSystemPrompt("Lead Agent", true, "run-without-issue")).not.toContain("```charter");
  });
});

describe("run一覧・状態遷移（DB直接投入によりCLI起動を回避）", () => {
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

  it("起動時に'active'/'queued'で残っていたrunは'error'へ復旧される（サーバー再起動想定）", async () => {
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), { id: "run-active", status: "active" });
    insertRunRow(getDb(), { id: "run-queued", status: "queued" });
    const rt = await loadModule();
    expect(rt.getRun("run-active")?.status).toBe("error");
    expect(rt.getRun("run-queued")?.status).toBe("error");
    expect(rt.getRun("run-active")?.log.some((l) => l.text.includes("実行状態が不明になった"))).toBe(true);
  });

  it("'idle'/'yield'/'error'で残っていたrunはそのままの状態で復元される", async () => {
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), { id: "run-idle", status: "idle" });
    const rt = await loadModule();
    expect(rt.getRun("run-idle")?.status).toBe("idle");
  });

  it("listRunsは作成日時の新しい順で返す", async () => {
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), { id: "run-old", created_at: 1 });
    insertRunRow(getDb(), { id: "run-new", created_at: 100 });
    const rt = await loadModule();
    expect(rt.listRuns().map((r) => r.id)).toEqual(["run-new", "run-old"]);
  });

  it("listRunsPageはフィルタ・ページングした結果とtotalを返す", async () => {
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), { id: "run-1", created_at: 5, status: "idle" });
    insertRunRow(getDb(), { id: "run-2", created_at: 4, status: "yield" });
    insertRunRow(getDb(), { id: "run-3", created_at: 3, status: "idle" });
    insertRunRow(getDb(), { id: "run-4", created_at: 2, status: "idle", triage_status: "dismissed" });
    const rt = await loadModule();

    const page1 = rt.listRunsPage({}, { limit: 2, offset: 0 });
    expect(page1.runs.map((r) => r.id)).toEqual(["run-1", "run-2"]);
    // 却下(dismissed)は既定で除外されるため、total 4件中3件が対象。
    expect(page1.total).toBe(3);

    const page2 = rt.listRunsPage({}, { limit: 2, offset: 2 });
    expect(page2.runs.map((r) => r.id)).toEqual(["run-3"]);

    const statusFiltered = rt.listRunsPage({ status: "yield" }, { limit: 10, offset: 0 });
    expect(statusFiltered.runs.map((r) => r.id)).toEqual(["run-2"]);

    const withDismissed = rt.listRunsPage({ showDismissed: true }, { limit: 10, offset: 0 });
    expect(withDismissed.total).toBe(4);
  });

  it("listRunsPageはrun.logを先頭の非systemログ行1件までに切り詰める", async () => {
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), { id: "run-1" });
    getDb()
      .prepare("INSERT INTO agent_run_logs (run_id, ts, channel, text) VALUES (?, ?, ?, ?)")
      .run("run-1", 1, "system", "起動しています…");
    getDb()
      .prepare("INSERT INTO agent_run_logs (run_id, ts, channel, text) VALUES (?, ?, ?, ?)")
      .run("run-1", 2, "agent", "検討中の結論その1");
    getDb()
      .prepare("INSERT INTO agent_run_logs (run_id, ts, channel, text) VALUES (?, ?, ?, ?)")
      .run("run-1", 3, "agent", "検討中の結論その2");
    const rt = await loadModule();
    const { runs } = rt.listRunsPage({}, { limit: 10, offset: 0 });
    expect(runs[0].log).toEqual([expect.objectContaining({ text: "検討中の結論その1" })]);
  });

  it("toRunViewはPERSON_n IDを実名に復元する", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const id = peopleDirectory.registerName("Aさん");
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), {
      id: "run-1",
      task: `${id}についてのタスク`,
      proposal_json: JSON.stringify({ conclusion: `${id}への対応`, facts: [], logic: "l", rejectedAlternatives: [] }),
    });
    const rt = await loadModule();
    const run = rt.getRun("run-1")!;
    const view = rt.toRunView(run);
    expect(view.task).toBe("Aさんについてのタスク");
    expect(view.proposal?.conclusion).toBe("Aさんへの対応");
  });

  it("markRunReviewedはreviewedをtrueにする（既にtrueなら何もしない）", async () => {
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), { id: "run-1", reviewed: 0 });
    const rt = await loadModule();
    expect(rt.getRun("run-1")?.reviewed).toBe(false);
    const updated = rt.markRunReviewed("run-1");
    expect(updated?.reviewed).toBe(true);
  });

  it("setRunTriageStatusはtriageStatus/triageAt/reviewedを設定する", async () => {
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), { id: "run-1", reviewed: 0 });
    const rt = await loadModule();
    const updated = rt.setRunTriageStatus("run-1", "watching");
    expect(updated?.triageStatus).toBe("watching");
    expect(updated?.reviewed).toBe(true);
    expect(updated?.triageAt).toBeDefined();
  });

  it("clearSuggestedActionItems/clearSuggestedSubIssuesは提案を消す", async () => {
    const { getDb } = await import("@/lib/db");
    insertRunRow(getDb(), {
      id: "run-1",
      suggested_action_items_json: JSON.stringify(["a"]),
      suggested_sub_issues_json: JSON.stringify(["b"]),
    });
    const rt = await loadModule();
    expect(rt.getRun("run-1")?.suggestedActionItems).toEqual(["a"]);
    rt.clearSuggestedActionItems("run-1");
    expect(rt.getRun("run-1")?.suggestedActionItems).toBeUndefined();
    rt.clearSuggestedSubIssues("run-1");
    expect(rt.getRun("run-1")?.suggestedSubIssues).toBeUndefined();
  });

  it("存在しないIDへの操作はundefinedを返す", async () => {
    const rt = await loadModule();
    expect(rt.markRunReviewed("missing")).toBeUndefined();
    expect(rt.setRunTriageStatus("missing", "dismissed")).toBeUndefined();
    expect(rt.clearSuggestedActionItems("missing")).toBeUndefined();
    expect(rt.getRun("missing")).toBeUndefined();
  });
});

describe("startRun（CLI起動・claude→agy→cursorのフォールバック連鎖）", () => {
  it("claudeが直接proposalを返した場合、そのままidleで完了する", async () => {
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "障害対応の方針を決めたい");

    await waitForSpawnCount(1);
    expect(spawnCalls[0].command).toBe("claude");
    expect(spawnCalls[0].args).toContain("-p");
    expect(spawnCalls[0].args).not.toContain("--resume");

    emitAssistantText(spawnCalls[0].child, "検討しています…");
    emitClaudeResult(spawnCalls[0].child, {
      sessionId: "sess-1",
      costUsd: 0.02,
      text: '```proposal\n{ "conclusion": "対応を継続", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(spawnCalls[0].child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    const finished = rt.getRun(run.id)!;
    expect(finished.status).toBe("idle");
    expect(finished.sessionId).toBe("sess-1");
    expect(finished.totalCostUsd).toBeCloseTo(0.02);
    expect(finished.proposal?.conclusion).toBe("対応を継続");
    expect(finished.log.some((l) => l.channel === "agent" && l.text === "検討しています…")).toBe(true);
  });

  it("設定でエージェント種別にモデル系統が指定されていれば--modelを渡す", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ agentModelTiers: { "Lead Agent": "opus" } });
    const rt = await loadModule();
    await rt.startRun("Lead Agent", "障害対応の方針を決めたい");

    await waitForSpawnCount(1);
    expect(spawnCalls[0].args).toContain("--model");
    expect(spawnCalls[0].args[spawnCalls[0].args.indexOf("--model") + 1]).toBe("opus");
  });

  it("設定でモデル系統が未指定のエージェントは--modelを渡さない", async () => {
    const rt = await loadModule();
    await rt.startRun("People Agent", "1on1の頻度を決めたい");

    await waitForSpawnCount(1);
    expect(spawnCalls[0].args).not.toContain("--model");
  });

  it("claudeがyieldブロックを返した場合、statusがyieldになる", async () => {
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "判断に迷うタスク");
    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      text: '```yield\n{ "reason": "情報不足", "options": [] }\n```',
    });
    closeChild(spawnCalls[0].child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    expect(rt.getRun(run.id)?.status).toBe("yield");
    expect(rt.getRun(run.id)?.yieldRequest?.reason).toBe("情報不足");
  });

  it("フォールバック無効のままclaudeが結果を返さず終了した場合、errorになりagy/cursorは起動しない", async () => {
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "落ちるタスク");
    await waitForSpawnCount(1);
    closeChild(spawnCalls[0].child, 1); // 結果イベント無しで終了

    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    expect(rt.getRun(run.id)?.status).toBe("error");
    expect(spawnCalls).toHaveLength(1);
    expect(rt.getRun(run.id)?.log.some((l) => l.text.includes("プロセスが結果を返さずに終了しました"))).toBe(true);
  });

  it("claude失敗→agyフォールバックが有効なら起動し、成功すればidleになる", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ agyFallbackAgents: ["Lead Agent"] });
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "落ちるタスク");

    await waitForSpawnCount(1);
    closeChild(spawnCalls[0].child, 1);

    await waitForSpawnCount(2);
    expect(spawnCalls[1].command).toBe("agy");
    emitAgyResult(spawnCalls[1].child, {
      text: '```proposal\n{ "conclusion": "agy経由の結論", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
      conversationId: "agy-conv-1",
    });
    closeChild(spawnCalls[1].child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    const finished = rt.getRun(run.id)!;
    expect(finished.status).toBe("idle");
    expect(finished.agyConversationId).toBe("agy-conv-1");
    expect(finished.proposal?.conclusion).toBe("agy経由の結論");
    expect(finished.log.some((l) => l.text.includes("agy経由でGeminiモデルにこのターンをフォールバック"))).toBe(true);
  });

  it("claude失敗→agy無効→cursorフォールバックが有効なら起動し、成功すればidleになる", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ cursorFallbackAgents: ["Lead Agent"] });
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "落ちるタスク");

    await waitForSpawnCount(1);
    closeChild(spawnCalls[0].child, 1);

    await waitForSpawnCount(2);
    expect(spawnCalls[1].command).toBe("cursor-agent");
    expect(spawnCalls[1].args).toContain("--workspace");
    emitCursorResult(spawnCalls[1].child, { sessionId: "cursor-sess-1", text: "cursor-agentからの回答。proposalなし。" });
    closeChild(spawnCalls[1].child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    const finished = rt.getRun(run.id)!;
    expect(finished.status).toBe("idle");
    expect(finished.cursorSessionId).toBe("cursor-sess-1");
    expect(finished.log.some((l) => l.text.includes("Cursor CLI経由でこのターンをフォールバック"))).toBe(true);
  });

  it("claude失敗→agyも失敗→cursorが有効なら3段目として起動し成功する", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ agyFallbackAgents: ["Lead Agent"], cursorFallbackAgents: ["Lead Agent"] });
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "落ちるタスク");

    await waitForSpawnCount(1);
    closeChild(spawnCalls[0].child, 1);
    await waitForSpawnCount(2);
    expect(spawnCalls[1].command).toBe("agy");
    closeChild(spawnCalls[1].child, 1); // agyも結果を返さず終了

    await waitForSpawnCount(3);
    expect(spawnCalls[2].command).toBe("cursor-agent");
    emitCursorResult(spawnCalls[2].child, { text: "cursorで復旧" });
    closeChild(spawnCalls[2].child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    expect(rt.getRun(run.id)?.status).toBe("idle");
  });

  it("claude/agy/cursorすべて失敗すればerrorのまま確定する", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ agyFallbackAgents: ["Lead Agent"], cursorFallbackAgents: ["Lead Agent"] });
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "全滅するタスク");

    await waitForSpawnCount(1);
    closeChild(spawnCalls[0].child, 1);
    await waitForSpawnCount(2);
    closeChild(spawnCalls[1].child, 1);
    await waitForSpawnCount(3);
    closeChild(spawnCalls[2].child, 1);

    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    expect(rt.getRun(run.id)?.status).toBe("error");
    expect(spawnCalls).toHaveLength(3);
  });

  it("maxParallelAgentRunsの上限に達すると後発のrunはqueuedで待機し、先発の枠解放後に起動する", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ maxParallelAgentRuns: 1 });
    const rt = await loadModule();

    await rt.startRun("Lead Agent", "1件目のタスク");
    await waitForSpawnCount(1);

    const run2 = await rt.startRun("Lead Agent", "2件目のタスク");
    await vi.waitFor(() => {
      if (rt.getRun(run2.id)?.status !== "queued") throw new Error("run2 is not queued yet");
    });
    expect(spawnCalls).toHaveLength(1); // run2はまだCLIを起動していない

    emitClaudeResult(spawnCalls[0].child, { text: '```proposal\n{ "conclusion": "c", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```' });
    closeChild(spawnCalls[0].child, 0);

    await waitForSpawnCount(2); // run1の枠解放を受けてrun2がCLIを起動する
    expect(rt.getRun(run2.id)?.status).toBe("active");
    emitClaudeResult(spawnCalls[1].child, { text: '```proposal\n{ "conclusion": "c2", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```' });
    closeChild(spawnCalls[1].child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(run2.id)?.status === "active" || rt.getRun(run2.id)?.status === "queued") throw new Error("still pending");
    });
    expect(rt.getRun(run2.id)?.status).toBe("idle");
  });
});

describe("decideRun", () => {
  it("実行中(active)または順番待ち(queued)のrunへの入力は拒否する", async () => {
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "タスク");
    await waitForSpawnCount(1); // まだactiveのまま
    await expect(rt.decideRun(run.id, "追加の指示")).rejects.toThrow("今は入力を受け付けられません");
  });

  it("存在しないrunはundefinedを返す", async () => {
    const rt = await loadModule();
    expect(await rt.decideRun("missing", "x")).toBeUndefined();
  });

  it("idle状態のrunはdecideRunで再開でき、既存sessionIdを--resumeで引き継ぐ", async () => {
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "最初のタスク");
    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      sessionId: "sess-1",
      text: '```proposal\n{ "conclusion": "一旦完了", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(spawnCalls[0].child, 0);
    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status !== "idle") throw new Error("not idle yet");
    });

    await rt.decideRun(run.id, "続けてください");
    await waitForSpawnCount(2);
    expect(spawnCalls[1].args).toContain("--resume");
    expect(spawnCalls[1].args[spawnCalls[1].args.indexOf("--resume") + 1]).toBe("sess-1");

    emitClaudeResult(spawnCalls[1].child, { sessionId: "sess-1", text: '```yield\n{ "reason": "続きは人間の判断が必要", "options": [] }\n```' });
    closeChild(spawnCalls[1].child, 0);
    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    expect(rt.getRun(run.id)?.status).toBe("yield");
  });
});

describe("Lead Agentのconsult協働ループ（handleConsult）", () => {
  it("consultブロックで専門エージェントを起動し、両者の回答を踏まえてLeadが最終proposalを出す", async () => {
    const rt = await loadModule();
    const leadRun = await rt.startRun("Lead Agent", "人と技術が絡む複合的な課題");

    await waitForSpawnCount(1);
    expect(spawnCalls[0].command).toBe("claude");
    emitClaudeResult(spawnCalls[0].child, {
      sessionId: "sess-lead-1",
      text: '```consult\n{ "agents": ["People Agent", "Tech Agent"], "question": "共通質問", "questions": { "People Agent": "人物面の質問", "Tech Agent": "技術面の質問" } }\n```',
    });
    closeChild(spawnCalls[0].child, 0);

    // consultを検知した時点でLead run自身はまだactive、専門エージェントrunが2件作られ
    // それぞれのconsultQuestionFor()による個別質問がtaskに反映されている。
    await vi.waitFor(() => {
      if (rt.listRuns().length < 3) throw new Error("specialist runs not created yet");
    });
    const peopleRun = rt.listRuns().find((r) => r.agentName === "People Agent")!;
    const techRun = rt.listRuns().find((r) => r.agentName === "Tech Agent")!;
    expect(peopleRun.task).toBe("人物面の質問");
    expect(techRun.task).toBe("技術面の質問");
    expect(peopleRun.consultedBy).toBe(leadRun.id);
    expect(techRun.consultedBy).toBe(leadRun.id);
    expect(rt.getRun(leadRun.id)?.status).toBe("active");

    // 専門エージェント2件分のCLI起動を待って、それぞれの回答を返す。
    await waitForSpawnCount(3);
    const peopleCall = spawnCalls.find((c) => c.args.includes("人物面の質問"))!;
    const techCall = spawnCalls.find((c) => c.args.includes("技術面の質問"))!;
    emitAssistantText(peopleCall.child, "People Agentとしての回答本文");
    emitClaudeResult(peopleCall.child, { sessionId: "sess-people-1", text: "People Agentとしての回答本文" });
    closeChild(peopleCall.child, 0);
    emitAssistantText(techCall.child, "Tech Agentとしての回答本文");
    emitClaudeResult(techCall.child, { sessionId: "sess-tech-1", text: "Tech Agentとしての回答本文" });
    closeChild(techCall.child, 0);

    // 両専門エージェントの回答が出揃うと、Leadのフォローアップターンが
    // 元のsessionId（sess-lead-1）を--resumeして起動する。
    await waitForSpawnCount(4);
    const followUpCall = spawnCalls[3];
    expect(followUpCall.command).toBe("claude");
    expect(followUpCall.args[followUpCall.args.indexOf("--resume") + 1]).toBe("sess-lead-1");
    const followUpPrompt = followUpCall.args[followUpCall.args.indexOf("-p") + 1];
    expect(followUpPrompt).toContain("People Agentとしての回答本文");
    expect(followUpPrompt).toContain("Tech Agentとしての回答本文");

    emitClaudeResult(followUpCall.child, {
      sessionId: "sess-lead-1",
      text: '```proposal\n{ "conclusion": "両専門家の見解を統合した結論", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(followUpCall.child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(leadRun.id)?.status === "active") throw new Error("still active");
    });
    const finishedLead = rt.getRun(leadRun.id)!;
    expect(finishedLead.status).toBe("idle");
    expect(finishedLead.proposal?.conclusion).toBe("両専門家の見解を統合した結論");
    expect(finishedLead.log.some((l) => l.text.includes("[People Agentからの回答]"))).toBe(true);
    expect(finishedLead.log.some((l) => l.text.includes("[Tech Agentからの回答]"))).toBe(true);
    expect(rt.getRun(peopleRun.id)?.status).toBe("idle");
    expect(rt.getRun(techRun.id)?.status).toBe("idle");
    expect(spawnCalls).toHaveLength(4); // Lead初回 + 専門2件 + Leadフォローアップの計4回のみ
  });

  it("フォローアップターンの応答に再びconsultブロックが含まれても孫consultとして扱わない", async () => {
    const rt = await loadModule();
    const leadRun = await rt.startRun("Lead Agent", "課題");
    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      sessionId: "sess-lead-1",
      text: '```consult\n{ "agents": ["People Agent"], "question": "質問" }\n```',
    });
    closeChild(spawnCalls[0].child, 0);

    await waitForSpawnCount(2);
    emitClaudeResult(spawnCalls[1].child, { text: "People Agentの回答" });
    closeChild(spawnCalls[1].child, 0);

    await waitForSpawnCount(3);
    const followUpCall = spawnCalls[2];
    // allowConsult:falseで呼ばれるフォローアップターンでは、consultブロックが
    // 返ってきても孫consultとしては処理されず、通常のテキスト（proposal無し）として扱われる。
    emitClaudeResult(followUpCall.child, {
      text: '```consult\n{ "agents": ["Tech Agent"], "question": "孫consultは無視されるはず" }\n```',
    });
    closeChild(followUpCall.child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(leadRun.id)?.status === "active") throw new Error("still active");
    });
    expect(rt.getRun(leadRun.id)?.status).toBe("idle"); // yieldでもactiveでもない＝孫consultとして処理されなかった
    expect(rt.getRun(leadRun.id)?.proposal).toBeUndefined(); // proposal形式にも従っていないため
    expect(spawnCalls).toHaveLength(3); // Tech Agentへの孫consultは起動されていない
  });
});

describe("watchdog: checkStaleRuns", () => {
  it("ハングした子プロセスを追跡できている場合はkillし、ログに残す（実際の状態確定はcloseイベント側）", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ agentKillAfterSeconds: 0 });
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "ハングしそうなタスク");
    await waitForSpawnCount(1);
    await new Promise((r) => setTimeout(r, 5)); // agentKillAfterSeconds:0を確実に超過させる

    rt.checkStaleRuns();
    expect(spawnCalls[0].child.kill).toHaveBeenCalledTimes(1);
    expect(rt.getRun(run.id)?.log.some((l) => l.text.includes("応答なしとみなして強制終了します"))).toBe(true);
    expect(rt.getRun(run.id)?.status).toBe("active"); // kill()自体はまだ状態を確定させない

    // killされた子プロセスが実際に終了したことをcloseイベントで再現する。
    closeChild(spawnCalls[0].child, 137);
    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    expect(rt.getRun(run.id)?.status).toBe("error");
  });

  it("閾値内であれば何もしない", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ agentKillAfterSeconds: 600 });
    const rt = await loadModule();
    await rt.startRun("Lead Agent", "まだ新しいタスク");
    await waitForSpawnCount(1);

    rt.checkStaleRuns();
    expect(spawnCalls[0].child.kill).not.toHaveBeenCalled();
  });

  it("activeなのに追跡中の子プロセスが無い場合は直接errorへ倒す（異常系への保険）", async () => {
    // consultで相談中のLead runは、自分自身のCLIプロセスは既にcloseしてliveProcessesから
    // 消えている一方、専門エージェントの回答を待つ間statusは"active"のまま——という
    // 実際に発生しうる状態を使って、この保険分岐を再現する。
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ agentKillAfterSeconds: 0 });
    const rt = await loadModule();
    const leadRun = await rt.startRun("Lead Agent", "複合的な課題");
    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      sessionId: "sess-lead-1",
      text: '```consult\n{ "agents": ["People Agent"], "question": "質問" }\n```',
    });
    closeChild(spawnCalls[0].child, 0);

    await vi.waitFor(() => {
      if (rt.listRuns().length < 2) throw new Error("specialist run not created yet");
    });
    await new Promise((r) => setTimeout(r, 5));

    rt.checkStaleRuns();
    expect(rt.getRun(leadRun.id)?.status).toBe("error");
    expect(rt.getRun(leadRun.id)?.log.some((l) => l.text.includes("実行中のプロセスも追跡できないため、エラー扱いにしました"))).toBe(true);

    // 後続の専門エージェント回答〜フォローアップターンをドレインしておく（テスト終了後に
    // 非同期処理が残らないようにする）。checkStaleRunsによる一時的なerror化に関わらず、
    // handleConsultのフォローアップターンはrunClaudeTurnの先頭でstatusを再度activeに戻すため、
    // 最終的にはconsultが完了しidleへ到達する。
    await waitForSpawnCount(2);
    emitClaudeResult(spawnCalls[1].child, { text: "People Agentの回答" });
    closeChild(spawnCalls[1].child, 0);
    await waitForSpawnCount(3);
    emitClaudeResult(spawnCalls[2].child, {
      text: '```proposal\n{ "conclusion": "結論", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(spawnCalls[2].child, 0);
    await vi.waitFor(() => {
      if (rt.getRun(leadRun.id)?.status !== "idle") throw new Error("not idle yet");
    });
  });
});

describe("watchdog: checkMorningSummary", () => {
  it("autoMorningSummaryEnabledが既定(false)なら何もしない", async () => {
    const rt = await loadModule();
    rt.checkMorningSummary();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
    expect(spawnCalls).toHaveLength(0);
  });

  it("設定時刻に達していなければ起動しない（hourを24にして『今日中は絶対到達しない』を再現）", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ autoMorningSummaryEnabled: true, autoMorningSummaryHour: 24 });
    const rt = await loadModule();
    rt.checkMorningSummary();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
  });

  it("設定時刻に達していれば当日1回だけLead Agentを自動起動する", async () => {
    // hour:0にすることで「今日中は常に到達済み」を実時刻に依存せず再現する。
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ autoMorningSummaryEnabled: true, autoMorningSummaryHour: 0 });
    const rt = await loadModule();

    rt.checkMorningSummary();
    await vi.waitFor(() => {
      if (rt.listRuns().length < 1) throw new Error("run not created yet");
    });
    const run = rt.listRuns()[0];
    expect(run.agentName).toBe("Lead Agent");
    expect(run.origin).toBe("auto-summary");
    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      text: '```proposal\n{ "conclusion": "サマリー完了", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(spawnCalls[0].child, 0);
    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });

    // 同日中の再呼び出しでは再度起動しない（重複生成の防止）。
    rt.checkMorningSummary();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(1);
    expect(spawnCalls).toHaveLength(1);
  });
});

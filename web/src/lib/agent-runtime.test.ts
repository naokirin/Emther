import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

// agent-runtime.tsは実際のCLI子プロセス（claude/agy/cursor-agent）を起動するstartRun/
// decideRun/runClaudeTurn等を持つが、それらはこのテストの対象外にする（node:child_processの
// spawnをモックする別途まとまった作業が必要）。ここでは、それらに依存しない
// 「純粋なパース関数」「プロンプト組み立て関数」、およびDBへ直接rowを仕込むことで
// 実プロセスを起動せずに検証できる「run一覧・状態遷移系の関数」だけを対象にする。
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
    expect(rt.extractYield(text)).toEqual({ reason: "情報不足", options: [{ id: "A", label: "選択肢A" }] });
  });

  it("extractYieldはoptionsが無ければ空配列にフォールバックする", async () => {
    const rt = await loadModule();
    const text = '```yield\n{ "reason": "理由のみ" }\n```';
    expect(rt.extractYield(text)?.options).toEqual([]);
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

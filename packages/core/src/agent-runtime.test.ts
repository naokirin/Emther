import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "./test-helpers/store-env";

// agent-runtime.tsの「純粋なパース関数」「プロンプト組み立て関数」「DBへ直接rowを仕込むことで
// 実プロセスを起動せずに検証できるrun一覧・状態遷移系の関数」は上のdescribeブロック群でカバー
// 済み。ここから下は、実際にCLI子プロセスを起動するstartRun/decideRun/runClaudeTurn（claude→agy→
// cursor-agentのフォールバック連鎖）と、Lead Agentのconsult協働ループ（handleConsult）を対象に、
// node:child_processのspawnを丸ごとモックして検証する。
vi.mock("./local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

// 既定は常に類似度0（無関係）。特定のテストだけ類似度を上げたい場合は
// cosineSimilarityRef.impl を差し替える（spawnRefと同じ間接呼び出しパターン）。
const cosineSimilarityRef = vi.hoisted(() => ({
  impl: (() => 0) as (...args: unknown[]) => number,
}));
vi.mock("./embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: (...args: unknown[]) => cosineSimilarityRef.impl(...args),
}));

// createJournalEventFromTextがdetectUnregisteredNameCandidatesを呼ぶようになったため、
const nameCandidateDetectRef = vi.hoisted(() => ({
  detectNameCandidatesAsync: (async () => [] as string[]) as (text: string) => Promise<string[]>,
}));
vi.mock("./name-candidate-detect", () => ({
  detectNameCandidatesAsync: (text: string) => nameCandidateDetectRef.detectNameCandidatesAsync(text),
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
}));

// vi.mockのファクトリはファイル先頭へホイストされるため、テストごとに差し替えたい実装は
// vi.hoistedで作った可変の参照（spawnRef.impl）越しに間接呼び出しする。実装の中身
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
  cosineSimilarityRef.impl = () => 0;
  nameCandidateDetectRef.detectNameCandidatesAsync = async () => [];
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModule() {
  return import("./agent-runtime/index");
}

describe("extractYield / extractProposal / extractActionItems / extractConsult", () => {
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
      expansions: [],
      challenges: [],
    });
  });

  it("extractProposalはexpansions/challengesを拾う", async () => {
    const rt = await loadModule();
    const text = [
      "```proposal",
      JSON.stringify({
        conclusion: "c",
        logic: "l",
        facts: [],
        rejectedAlternatives: [],
        expansions: ["チーム全体で発言が減っている可能性", "  ", 123],
        challenges: ["発言量自体が問題なのか"],
      }),
      "```",
    ].join("\n");
    expect(rt.extractProposal(text)).toEqual({
      conclusion: "c",
      facts: [],
      logic: "l",
      rejectedAlternatives: [],
      expansions: ["チーム全体で発言が減っている可能性"],
      challenges: ["発言量自体が問題なのか"],
    });
  });

  it("extractProposalはrecommendationを拾う", async () => {
    const rt = await loadModule();
    const text = '```proposal\n{ "conclusion": "c", "logic": "l", "facts": [], "rejectedAlternatives": [], "recommendation": "dismiss" }\n```';
    expect(rt.extractProposal(text)?.recommendation).toBe("dismiss");
  });

  it("extractProposalはsuggestionTitleを拾う", async () => {
    const rt = await loadModule();
    const text =
      '```proposal\n{ "conclusion": "c", "logic": "l", "facts": [], "rejectedAlternatives": [], "recommendation": "suggestion", "suggestionTitle": "短い課題名" }\n```';
    expect(rt.extractProposal(text)?.suggestionTitle).toBe("短い課題名");
  });

  it("extractProposalはadvice文字列をadviceStructuredに正規化する", async () => {
    const rt = await loadModule();
    const text =
      '```proposal\n{ "conclusion": "c", "logic": "l", "facts": [], "rejectedAlternatives": [], "advice": "計画のコツ" }\n```';
    const p = rt.extractProposal(text);
    expect(p?.adviceStructured?.overview).toBe("計画のコツ");
    expect(p?.advice).toBeUndefined();
  });

  it("extractProposalは空文字のadviceを無視する", async () => {
    const rt = await loadModule();
    const text = '```proposal\n{ "conclusion": "c", "logic": "l", "facts": [], "rejectedAlternatives": [], "advice": "  " }\n```';
    expect(rt.extractProposal(text)?.adviceStructured).toBeUndefined();
  });

  it("extractProposalはadviceオブジェクトを拾う", async () => {
    const rt = await loadModule();
    const text = [
      "```proposal",
      JSON.stringify({
        conclusion: "c",
        logic: "l",
        facts: [],
        rejectedAlternatives: [],
        advice: {
          overview: "全体",
          groups: [{ title: "第一歩", nextActions: ["話す"], watchOuts: ["急がない"] }],
          followUps: [{ label: "分解して", message: "タスクに分解して" }],
        },
      }),
      "```",
    ].join("\n");
    const p = rt.extractProposal(text);
    expect(p?.adviceStructured?.overview).toBe("全体");
    expect(p?.adviceStructured?.groups[0]?.title).toBe("第一歩");
    expect(p?.adviceStructured?.followUps?.[0]?.label).toBe("分解して");
  });

  it("extractProposalはlensesUsedを拾う", async () => {
    const rt = await loadModule();
    const text = [
      "```proposal",
      JSON.stringify({
        conclusion: "c",
        logic: "l",
        facts: [],
        rejectedAlternatives: [],
        lensesUsed: [
          { lens: "Systems Thinking", insight: "レビュー待ちが手戻りを増やしている可能性" },
          { lens: "", insight: "不正な要素は除外される" },
          { lens: "Lean", insight: "" },
          "文字列だけの不正な要素も除外される",
        ],
      }),
      "```",
    ].join("\n");
    expect(rt.extractProposal(text)?.lensesUsed).toEqual([
      { lens: "Systems Thinking", insight: "レビュー待ちが手戻りを増やしている可能性" },
    ]);
  });

  it("extractProposalはlensesUsed未指定でも既存フィールドだけで動く（旧run互換）", async () => {
    const rt = await loadModule();
    const text = '```proposal\n{ "conclusion": "c", "logic": "l", "facts": [], "rejectedAlternatives": [] }\n```';
    expect(rt.extractProposal(text)?.lensesUsed).toBeUndefined();
  });

  it("extractProposalはsuggestionCandidatesを拾う", async () => {
    const rt = await loadModule();
    const text = [
      "```proposal",
      JSON.stringify({
        conclusion: "c",
        logic: "l",
        facts: [],
        rejectedAlternatives: [],
        expansions: [],
        challenges: [],
        recommendation: "suggestion",
        suggestionCandidates: [
          { title: "燃え尽きへの介入", rationale: "個人軸" },
          { title: "リリース属人化の解消" },
          "  ",
          { title: "" },
          "文字列だけの候補",
        ],
      }),
      "```",
    ].join("\n");
    expect(rt.extractProposal(text)?.suggestionCandidates).toEqual([
      { title: "燃え尽きへの介入", rationale: "個人軸" },
      { title: "リリース属人化の解消" },
      { title: "文字列だけの候補" },
    ]);
  });

  it("listSuggestionCandidatesFromProposalはsuggestionCandidatesを優先する", async () => {
    const rt = await loadModule();
    expect(
      rt.listSuggestionCandidatesFromProposal({
        conclusion: "c",
        logic: "l",
        facts: [],
        rejectedAlternatives: [],
        expansions: [],
        challenges: [],
        suggestionTitle: "代表",
        suggestionCandidates: [{ title: "A" }, { title: "B" }],
      }),
    ).toEqual([{ title: "A" }, { title: "B" }]);
    expect(
      rt.listSuggestionCandidatesFromProposal({
        conclusion: "c",
        logic: "l",
        facts: [],
        rejectedAlternatives: [],
        expansions: [],
        challenges: [],
        suggestionTitle: "単一",
      }),
    ).toEqual([{ title: "単一" }]);
  });

  it("extractProposalは空のsuggestionTitleを無視する", async () => {
    const rt = await loadModule();
    const text =
      '```proposal\n{ "conclusion": "c", "logic": "l", "facts": [], "rejectedAlternatives": [], "suggestionTitle": "  " }\n```';
    expect(rt.extractProposal(text)?.suggestionTitle).toBeUndefined();
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

  it("extractSuggestionNotesはsuggestionId/textが揃った要素だけをパースする", async () => {
    const rt = await loadModule();
    const text = '```suggestion_note\n[{ "suggestionId": "abc123", "text": "関連する事実" }, { "suggestionId": "" , "text": "x" }, { "text": "suggestionId無し" }]\n```';
    expect(rt.extractSuggestionNotes(text)).toEqual([{ suggestionId: "abc123", text: "関連する事実" }]);
  });

  it("extractSuggestionNotesは全項目が空/ブロックなしの場合undefined", async () => {
    const rt = await loadModule();
    expect(rt.extractSuggestionNotes('```suggestion_note\n[]\n```')).toBeUndefined();
    expect(rt.extractSuggestionNotes("ブロックなし")).toBeUndefined();
  });

  it("extractSuggestionUpdatesはsuggestionId/reasonが揃い、何らかの変更を含む要素だけをパースする", async () => {
    const rt = await loadModule();
    const text =
      '```suggestion_updates\n[' +
      '{ "suggestionId": "abc123", "reviewStatus": "done", "reason": "対応済みのため" }, ' +
      '{ "suggestionId": "", "reviewStatus": "done", "reason": "IDなし" }, ' +
      '{ "suggestionId": "def456", "reason": "変更フィールドが無い" }, ' +
      '{ "suggestionId": "ghi789", "reviewStatus": "done" }' +
      ']\n```';
    expect(rt.extractSuggestionUpdates(text)).toEqual([
      { suggestionId: "abc123", reviewStatus: "done", reason: "対応済みのため" },
    ]);
  });

  it("extractSuggestionUpdatesは不正なreviewStatus/confirmPriorityの値を無視する", async () => {
    const rt = await loadModule();
    const text =
      '```suggestion_updates\n[{ "suggestionId": "abc", "reviewStatus": "not-a-status", "confirmPriority": "focus", "reason": "テスト" }]\n```';
    expect(rt.extractSuggestionUpdates(text)).toEqual([{ suggestionId: "abc", confirmPriority: "focus", reason: "テスト" }]);
  });

  it("extractSuggestionUpdatesはreviewDueAtの日付文字列をタイムスタンプに変換し、nullは解除として扱う", async () => {
    const rt = await loadModule();
    const text =
      '```suggestion_updates\n[' +
      '{ "suggestionId": "abc", "reviewDueAt": "2026-03-05", "reason": "期日設定" }, ' +
      '{ "suggestionId": "def", "reviewDueAt": null, "reason": "解除" }' +
      ']\n```';
    const result = rt.extractSuggestionUpdates(text);
    expect(result?.[0]).toEqual({ suggestionId: "abc", reviewDueAt: expect.any(Number), reason: "期日設定" });
    expect(result?.[1]).toEqual({ suggestionId: "def", reviewDueAt: null, reason: "解除" });
  });

  it("extractSuggestionUpdatesは全項目が空/ブロックなしの場合undefined", async () => {
    const rt = await loadModule();
    expect(rt.extractSuggestionUpdates('```suggestion_updates\n[]\n```')).toBeUndefined();
    expect(rt.extractSuggestionUpdates("ブロックなし")).toBeUndefined();
  });

  it("extractThemesは必須フィールドがあるテーマだけをパースする", async () => {
    const rt = await loadModule();
    const text = `\`\`\`themes
[
  { "title": "承認滞留", "summary": "決裁が詰まる", "rationale": "複数Issueで同様", "facts": ["f1"] },
  { "title": "不完全", "summary": "x" }
]
\`\`\``;
    expect(rt.extractThemes(text)).toEqual([
      { title: "承認滞留", summary: "決裁が詰まる", rationale: "複数Issueで同様", facts: ["f1"] },
    ]);
  });

  it("extractPeriodReviewはoverview/interpretationが揃っていればパースし、不正な配列要素はスキップする", async () => {
    const rt = await loadModule();
    const text = `\`\`\`period_review
{
  "overview": "今週は判断待ちが多かった",
  "observations": ["Journal 12件", ""],
  "interpretation": "意思決定の所在が曖昧な可能性",
  "comparisons": [
    { "area": "PO確認", "before": "曖昧", "after": "明文化", "assessment": "improved" },
    { "area": "不完全", "before": "x" }
  ],
  "blindSpots": [
    { "question": "メンバーの記録が減ったのは改善か観測不足か", "reason": "先週比で半減" },
    { "question": "理由なし" }
  ],
  "learnings": ["判断の所在を明示すると動きやすい"],
  "nextQuestions": ["来週も判断待ちの件数を見る"]
}
\`\`\``;
    expect(rt.extractPeriodReview(text)).toEqual({
      overview: "今週は判断待ちが多かった",
      observations: ["Journal 12件"],
      interpretation: "意思決定の所在が曖昧な可能性",
      comparisons: [{ area: "PO確認", before: "曖昧", after: "明文化", assessment: "improved" }],
      blindSpots: [{ question: "メンバーの記録が減ったのは改善か観測不足か", reason: "先週比で半減" }],
      learnings: ["判断の所在を明示すると動きやすい"],
      nextQuestions: ["来週も判断待ちの件数を見る"],
    });
  });

  it("extractPeriodReviewはoverview/interpretationが欠落していればundefined", async () => {
    const rt = await loadModule();
    expect(rt.extractPeriodReview('```period_review\n{ "observations": [] }\n```')).toBeUndefined();
    expect(rt.extractPeriodReview("ブロックなし")).toBeUndefined();
  });

  it("extractGrowSuggestionsは必須フィールドがある提案だけをパースする", async () => {
    const rt = await loadModule();
    const text = `\`\`\`grow_suggestions
[
  { "title": "1on1の傾聴", "rationale": "繰り返し同じ相談が来ている", "evidenceSummary": "直近3件のメモ", "references": [{ "topic": "コーチング", "isPrimarySource": false, "note": "入門書" }, { "topic": "" }] },
  { "title": "不完全" }
]
\`\`\``;
    expect(rt.extractGrowSuggestions(text)).toEqual([
      {
        title: "1on1の傾聴",
        rationale: "繰り返し同じ相談が来ている",
        evidenceSummary: "直近3件のメモ",
        references: [{ topic: "コーチング", isPrimarySource: false, note: "入門書" }],
      },
    ]);
  });

  it("extractGrowSuggestionsはhttp(s)形式のurlだけを採用する", async () => {
    const rt = await loadModule();
    const text = `\`\`\`grow_suggestions
[{ "title": "学びA", "rationale": "根拠A", "references": [
  { "topic": "コーチング", "isPrimarySource": false, "url": "https://example.com/coaching" },
  { "topic": "怪しいリンク", "isPrimarySource": false, "url": "javascript:alert(1)" },
  { "topic": "urlなし", "isPrimarySource": false }
] }]
\`\`\``;
    expect(rt.extractGrowSuggestions(text)?.[0].references).toEqual([
      { topic: "コーチング", isPrimarySource: false, url: "https://example.com/coaching" },
      { topic: "怪しいリンク", isPrimarySource: false },
      { topic: "urlなし", isPrimarySource: false },
    ]);
  });

  it("extractGrowSuggestionsはブロックが無ければundefined", async () => {
    const rt = await loadModule();
    expect(rt.extractGrowSuggestions("ブロックなし")).toBeUndefined();
    expect(rt.extractGrowSuggestions("```grow_suggestions\n[]\n```")).toBeUndefined();
  });

  it("buildThemesContextBlockは採用済みテーマだけを載せる", async () => {
    const themeStore = await import("./theme-store");
    const candidate = await themeStore.createThemeCandidate({
      title: "テーマA",
      summary: "見立てA",
      rationale: "根拠A",
      facts: ["f"],
    });
    await themeStore.adoptTheme(candidate.id);
    const rt = await loadModule();
    const block = rt.buildThemesContextBlock();
    expect(block).toContain("テーマA");
    expect(block).toContain("なぜこの解釈か");
  });

  it("蒸留のtaskは短く、材料はcontextブロック側に載る", async () => {
    const rt = await loadModule();
    expect(rt.buildDistillationTask().length).toBeLessThan(200);
    expect(rt.DISTILLATION_TASK).toBe(rt.buildDistillationTask());
    const ctx = rt.buildDistillationContextBlock();
    expect(ctx).toContain("直近Journal");
    expect(ctx).toContain("```themes");
    expect(ctx).toContain("suggestedDirection は『採用せよ』ではなく");
    expect(ctx).toContain("試す価値がある候補のひとつ");
  });

  it("朝サマリーの材料はcontextブロックに載り、buildSystemPromptへ注入される", async () => {
    const orgStore = await import("./org-context-store/index");
    const suggestionStore = await import("./suggestion-store");
    orgStore.addTeam("Morning Team", ["Aさん"]);
    const issue = await suggestionStore.createSuggestion("未整理の課題");
    const rt = await loadModule();

    const ctx = rt.buildMorningSummaryContextBlock();
    expect(ctx).toContain("Team Vitals");
    expect(ctx).toContain("1on1 Coverage");
    expect(ctx).toContain("未整理の課題");
    expect(ctx).toContain(issue.id);
    expect(ctx).toContain("頻度抑制");
    expect(ctx).toContain("日次抑制中の提案");
    expect(rt.MORNING_SUMMARY_TASK.length).toBeLessThan(200);

    const run = await rt.startRun("Lead Agent", rt.MORNING_SUMMARY_TASK, "auto-summary");
    const prompt = rt.buildSystemPrompt("Lead Agent", true, run.id);
    expect(prompt).toContain("朝のサマリーの材料");
    expect(prompt).toContain("注入済みのナレッジブロック");
    expect(prompt).not.toContain("与えられたタスクの文脈だけを判断材料とし");
  });

  it("朝サマリーの材料は実名をPERSON_nにマスクしてから返す", async () => {
    const pd = await import("./people-directory");
    const orgStore = await import("./org-context-store/index");
    pd.registerName("漏洩太郎");
    // チーム名に実名が含まれると、Vitals理由文にも載る（送信前 assert の発火源になり得る）。
    orgStore.addTeam("漏洩太郎チーム", []);
    const rt = await loadModule();
    const ctx = rt.buildMorningSummaryContextBlock();
    expect(ctx).not.toContain("漏洩太郎");
    expect(ctx).toMatch(/PERSON_\d+/);
  });

  it("Growの材料はEM自己申告と組織側の解釈を横断し、grow_suggestionsの出力指示を含む", async () => {
    const emSelfStore = await import("./em-self-store");
    const knowledgeStore = await import("./knowledge-store");
    await emSelfStore.addCheckin({ mood: 2, energy: 2, stress: 4, headroom: 2, note: "割り込みが多い" });
    await emSelfStore.addReflectionNote({ type: "problem", text: "計画作業の時間が取れない" });
    knowledgeStore.recordEvent({
      kind: "interpretation",
      context: "observation",
      entityType: "team",
      entityId: "team-1",
      people: [],
      text: "チームの意思決定が停滞しがち",
      tags: [],
      summary: "意思決定の停滞",
      occurredAt: Date.now(),
    });
    const rt = await loadModule();
    const ctx = rt.buildGrowContextBlock();
    expect(ctx).toContain("割り込みが多い");
    expect(ctx).toContain("計画作業の時間が取れない");
    expect(ctx).toContain("意思決定の停滞");
    expect(ctx).toContain("```grow_suggestions");
    expect(ctx).toContain("評価ではなく判断材料");
    // EMとして視点を拡げるため、経営・隣接分野も候補に含める指示（2026-09-17）。
    expect(ctx).toContain("EMとして視点を拡げる");
    expect(ctx).toContain("経営");
    expect(ctx).toContain("エンジニアリング実務以外");
    expect(ctx).toContain("試す価値がある候補のひとつ");
    expect(ctx).toContain("このフレームワークでやるべき");
    expect(rt.GROWTH_TASK.length).toBeLessThan(200);
  });

  it("Growの材料は実名をPERSON_nにマスクしてから返す", async () => {
    const pd = await import("./people-directory");
    const emSelfStore = await import("./em-self-store");
    pd.registerName("漏洩太郎");
    await emSelfStore.addCheckin({ mood: 3, energy: 3, stress: 3, headroom: 3, note: "漏洩太郎との1on1で気づいたこと" });
    const rt = await loadModule();
    const ctx = rt.buildGrowContextBlock();
    expect(ctx).not.toContain("漏洩太郎");
    expect(ctx).toMatch(/PERSON_\d+/);
  });

  it("origin=auto-growのrunはbuildSystemPromptにGrowの材料を注入する", async () => {
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", rt.GROWTH_TASK, "auto-grow");
    const prompt = rt.buildSystemPrompt("Lead Agent", true, run.id);
    expect(prompt).toContain("学びの提案（Grow）の材料");
  });

  it("Journal集約解釈の材料は前回以降のJournalをまとめて載せ、taskは短い", async () => {
    const journalStore = await import("./journal-store");
    await journalStore.addJournalEntry("1on1が空回りした");
    const rt = await loadModule();
    const ctx = rt.buildJournalBatchContextBlock();
    expect(ctx).toContain("Journal集約解釈の材料");
    expect(ctx).toContain("前回解釈以降のJournal");
    expect(ctx).toContain("1on1が空回りした");
    expect(rt.JOURNAL_BATCH_TASK.length).toBeLessThan(200);
  });

  it("Journal集約解釈の材料は実名をPERSON_nにマスクしてから返す", async () => {
    const pd = await import("./people-directory");
    const journalStore = await import("./journal-store");
    pd.registerName("漏洩太郎");
    await journalStore.addJournalEntry("漏洩太郎さんが辞めたいと言っていた");
    const rt = await loadModule();
    const ctx = rt.buildJournalBatchContextBlock();
    expect(ctx).not.toContain("漏洩太郎");
    expect(ctx).toMatch(/PERSON_\d+/);
  });

  it("origin=auto-journal-batchのrunはbuildSystemPromptにJournal集約解釈の材料を注入する", async () => {
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", rt.JOURNAL_BATCH_TASK, "auto-journal-batch");
    const prompt = rt.buildSystemPrompt("Lead Agent", true, run.id);
    expect(prompt).toContain("Journal集約解釈の材料");
  });

  it("extractJournalAutoAnalysisTextは対象エントリ本文を取り出す", async () => {
    const rt = await loadModule();
    const task = [
      "前置き。",
      "",
      '対象のJournalエントリ: "1on1が空回りした"',
    ].join("\n");
    expect(rt.extractJournalAutoAnalysisText(task)).toBe("1on1が空回りした");
  });

  it("buildSystemPromptはrelatedContextを含める", async () => {
    const rt = await loadModule();
    const prompt = rt.buildSystemPrompt("Lead Agent", true, undefined, undefined, undefined, "関連束テスト");
    expect(prompt).toContain("関連束テスト");
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

  it("extractConsultはExec Agentを受け付ける", async () => {
    const rt = await loadModule();
    const text = '```consult\n{ "agents": ["Exec Agent"], "question": "経営レビュー" }\n```';
    expect(rt.extractConsult(text)?.agents).toEqual(["Exec Agent"]);
  });

  it("ensureRequiredConsultは必須先が欠けていれば合流する", async () => {
    const rt = await loadModule();
    const merged = rt.ensureRequiredConsult(
      { agentName: "Lead Agent", task: "方針相談", requiredConsultAgents: ["Exec Agent"] },
      { agents: ["People Agent"], question: "人物面だけ" },
      true,
    );
    expect(merged?.agents).toEqual(["People Agent", "Exec Agent"]);
    expect(merged?.questions?.["Exec Agent"]).toContain("経営／役員目線");
  });

  it("ensureRequiredConsultはconsult無しなら必須先だけのconsultを返す", async () => {
    const rt = await loadModule();
    const forced = rt.ensureRequiredConsult(
      { agentName: "Lead Agent", task: "方針相談", requiredConsultAgents: ["Exec Agent"] },
      undefined,
      true,
    );
    expect(forced?.agents).toEqual(["Exec Agent"]);
    expect(forced?.question).toContain("方針相談");
  });

  it("ensureRequiredConsultはallowConsult=falseなら強制しない", async () => {
    const rt = await loadModule();
    expect(
      rt.ensureRequiredConsult(
        { agentName: "Lead Agent", task: "方針相談", requiredConsultAgents: ["Exec Agent"] },
        undefined,
        false,
      ),
    ).toBeUndefined();
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

describe("relevantTeams", () => {
  const teamA = { id: "t1", name: "Engineering", members: [], charter: { mission: "", constraints: "" }, archived: false, managedByEm: true, aliases: ["エンジニアリングチーム"], createdAt: 0, updatedAt: 0 };
  const teamB = { id: "t2", name: "Sales", members: [], charter: { mission: "", constraints: "" }, archived: false, managedByEm: true, aliases: [], createdAt: 0, updatedAt: 0 };

  it("手がかりが無ければ全チームを返す", async () => {
    const rt = await loadModule();
    expect(rt.relevantTeams([teamA, teamB], undefined, undefined)).toEqual([teamA, teamB]);
  });

  it("rawTextにチーム名の言及があれば絞り込む", async () => {
    const rt = await loadModule();
    expect(rt.relevantTeams([teamA, teamB], undefined, "Engineeringの状況について")).toEqual([teamA]);
  });

  it("rawTextに正式名ではなく別名の言及があっても絞り込む", async () => {
    const rt = await loadModule();
    expect(rt.relevantTeams([teamA, teamB], undefined, "エンジニアリングチームの状況について")).toEqual([teamA]);
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
    const orgStore = await import("./org-context-store/index");
    orgStore.addTeam("Team A", ["Aさん"]);
    const rt = await loadModule();
    const block = rt.buildOrgContextBlock();
    expect(block).toContain("組織のチーム構成");
    expect(block).toContain("Team A");
  });

  it("selfPersonIdが設定されていれば利用者本人として明示する", async () => {
    const orgStore = await import("./org-context-store/index");
    const peopleDirectory = await import("./people-directory");
    const settings = await import("./settings-store");
    const selfId = peopleDirectory.registerName("EM本人");
    orgStore.addTeam("Team A", ["EM本人", "Aさん"]);
    settings.setSelfPersonId(selfId);
    const rt = await loadModule();
    const block = rt.buildOrgContextBlock();
    expect(block).toContain(`利用者本人（このアプリを使うEM）: ${selfId}`);
    expect(block).toContain(`${selfId}（利用者本人）`);
  });
});

describe("buildStrategyBlock / buildOrgBackgroundBlock", () => {
  it("MVVが未設定なら空文字列", async () => {
    const rt = await loadModule();
    expect(rt.buildStrategyBlock()).toBe("");
  });

  it("設定済みの項目だけ行として含める", async () => {
    const orgStore = await import("./org-context-store/index");
    await orgStore.updateOrgStrategy({ mission: "顧客に価値を届ける" });
    const rt = await loadModule();
    const block = rt.buildStrategyBlock();
    expect(block).toContain("Mission: 顧客に価値を届ける");
    expect(block).not.toContain("Vision:");
  });

  it("Standing Backgroundのalwaysは常に含み、taggedは手がかりがあるときだけ", async () => {
    const orgStore = await import("./org-context-store/index");
    await orgStore.addOrgBackground({
      title: "2024 個人情報漏洩",
      fact: "顧客データが流出した",
      implication: "セキュリティ投資を軽視しない",
      scope: "always",
      tags: ["security"],
    });
    await orgStore.addOrgBackground({
      title: "去年赤字",
      fact: "通期で最終赤字",
      implication: "採用はコスト感度が高い",
      scope: "tagged",
      tags: ["finance"],
    });
    const rt = await loadModule();

    const alwaysOnly = rt.buildOrgBackgroundBlock();
    expect(alwaysOnly).toContain("2024 個人情報漏洩");
    expect(alwaysOnly).toContain("事実: 顧客データが流出した");
    expect(alwaysOnly).toContain("含意: セキュリティ投資を軽視しない");
    expect(alwaysOnly).not.toContain("去年赤字");

    const withFinance = rt.buildOrgBackgroundBlock(undefined, "今期の採用予算と finance の見直し");
    expect(withFinance).toContain("去年赤字");
  });

  it("アーカイブ済みStanding Backgroundは注入しない", async () => {
    const orgStore = await import("./org-context-store/index");
    const entry = await orgStore.addOrgBackground({
      title: "古いインシデント",
      fact: "もう効かない",
      scope: "always",
    });
    await orgStore.updateOrgBackground(entry.id, { status: "archived" });
    const rt = await loadModule();
    expect(rt.buildOrgBackgroundBlock()).toBe("");
  });
});

describe("buildPolicyContextBlock", () => {
  it("Policyが無ければ空文字列", async () => {
    const rt = await loadModule();
    expect(rt.buildPolicyContextBlock()).toBe("");
  });

  it("登録済みPolicyを絶対の前提として含める", async () => {
    const orgStore = await import("./org-context-store/index");
    await orgStore.addPolicy({ text: "現場の裁量を優先する", category: "priority" });
    const rt = await loadModule();
    expect(rt.buildPolicyContextBlock()).toContain("現場の裁量を優先する");
  });

  it("アーカイブ済みPolicyは注入しない", async () => {
    const orgStore = await import("./org-context-store/index");
    const entry = await orgStore.addPolicy({ text: "もう使わない方針" });
    await orgStore.updatePolicy(entry.id, { archivedAt: Date.now() });
    const rt = await loadModule();
    expect(rt.buildPolicyContextBlock()).toBe("");
  });
});

describe("buildGoalsContextBlock", () => {
  it("Goalが無ければ空文字列", async () => {
    const rt = await loadModule();
    expect(rt.buildGoalsContextBlock()).toBe("");
  });

  it("登録済みGoalを絶対の前提として含める", async () => {
    const orgStore = await import("./org-context-store/index");
    await orgStore.addGoal({ title: "チームの自律性を高めたい", horizon: "mid" });
    const rt = await loadModule();
    const block = rt.buildGoalsContextBlock();
    expect(block).toContain("チームの自律性を高めたい");
    expect(block).toContain("中間Goal");
  });

  it("達成済み・断念済みGoalは注入しない", async () => {
    const orgStore = await import("./org-context-store/index");
    const goal = await orgStore.addGoal({ title: "もう終わったGoal" });
    await orgStore.updateGoal(goal.id, { status: "achieved" });
    const rt = await loadModule();
    expect(rt.buildGoalsContextBlock()).toBe("");
  });
});

describe("buildSuggestionContextBlock / buildTeamCharterBlock / buildInterventionTypeGuidance", () => {
  it("runIdに紐づくIssueが無ければ空文字列", async () => {
    const rt = await loadModule();
    expect(rt.buildSuggestionContextBlock("missing-run")).toBe("");
  });

  it("charterが空でもタイトルは含める", async () => {
    const suggestionStore = await import("./suggestion-store");
    await suggestionStore.createSuggestion("提案", { agentRunId: "run-1" });
    const rt = await loadModule();
    expect(rt.buildSuggestionContextBlock("run-1")).toContain("タイトル: 提案");
  });

  it("charter相当の内容はメモとして前提に含める", async () => {
    const suggestionStore = await import("./suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("障害対応", { agentRunId: "run-1" });
    await suggestionStore.updateSuggestionCharter(suggestion.id, { why: "顧客影響を止める", what: "原因特定", how: "ログ調査" });
    const rt = await loadModule();
    const block = rt.buildSuggestionContextBlock("run-1");
    expect(block).toContain("タイトル: 障害対応");
    expect(block).toContain("最近のメモ:");
    expect(block).toContain("顧客影響を止める");
    expect(block).toContain("ログ調査");
  });

  it("Issueにチームが紐付いていなければteam charterは空文字列", async () => {
    const suggestionStore = await import("./suggestion-store");
    await suggestionStore.createSuggestion("提案", { agentRunId: "run-1" });
    const rt = await loadModule();
    expect(rt.buildTeamCharterBlock("run-1")).toBe("");
  });

  it("チームのMission/制約が設定されていれば含める", async () => {
    const suggestionStore = await import("./suggestion-store");
    const orgStore = await import("./org-context-store/index");
    const team = orgStore.addTeam("Team A", []);
    await orgStore.updateTeam(team.id, { mission: "価値を届ける", constraints: "予算内で行う" });
    await suggestionStore.createSuggestion("提案", { agentRunId: "run-1", teamId: team.id });
    const rt = await loadModule();
    const block = rt.buildTeamCharterBlock("run-1");
    expect(block).toContain("Mission: 価値を届ける");
    expect(block).toContain("制約: 予算内で行う");
  });

  it("介入の型タグは廃止のためガイダンスは空", async () => {
    const suggestionStore = await import("./suggestion-store");
    await suggestionStore.createSuggestion("1on1改善", { agentRunId: "run-1" });
    const rt = await loadModule();
    expect(rt.buildInterventionTypeGuidance("run-1", "People Agent")).toBe("");
    expect(rt.buildInterventionTypeGuidance("run-1", "Process Agent")).toBe("");
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
    expect(prompt).toContain("Exec Agent");
  });

  it("哲学レンズのカタログとLens Selectionを踏まえた分析順序を含む（全エージェント共通）", async () => {
    const rt = await loadModule();
    const lead = rt.buildSystemPrompt("Lead Agent", true);
    const people = rt.buildSystemPrompt("People Agent", false);
    for (const prompt of [lead, people]) {
      expect(prompt).toContain("Lens Selection");
      expect(prompt).toContain("Hypothesis");
      expect(prompt).toContain("Agile");
      expect(prompt).toContain("Scrum / Empiricism");
      expect(prompt).toContain("Lean");
      expect(prompt).toContain("DORA / Capability");
      expect(prompt).toContain("Design Thinking");
      expect(prompt).toContain("Systems Thinking");
      expect(prompt).toContain("lensesUsed");
      expect(prompt).toContain("試す価値がある候補のひとつ");
      expect(prompt).toContain("advice（overview / groups の候補のひとつ）");
    }
  });

  it("requiredConsultAgents付きrunでは必須consult指示が入る", async () => {
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "方針を固めたい", "manual", undefined, {
      requiredConsultAgents: ["Exec Agent"],
    });
    const prompt = rt.buildSystemPrompt("Lead Agent", true, run.id);
    expect(prompt).toContain("【必須】");
    expect(prompt).toContain("Exec Agent");
  });

  it("Exec Agentの役割定義がプロンプトに入る", async () => {
    const rt = await loadModule();
    const prompt = rt.buildSystemPrompt("Exec Agent", false);
    expect(prompt).toContain("企業経営・役員目線");
    expect(prompt).toContain("共感や現場配慮で結論を甘くしない");
  });

  it("全エージェントのプロンプトにlookupブロックの説明を含む", async () => {
    const rt = await loadModule();
    const lead = rt.buildSystemPrompt("Lead Agent", true);
    const people = rt.buildSystemPrompt("People Agent", false);
    expect(lead).toContain("```lookup");
    expect(lead).toContain('"type": "suggestions"');
    expect(lead).toContain("上位最大5件");
    expect(people).toContain("```lookup");
    expect(people).toContain("追加照会");
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

  it("sub_issuesブロック説明は付かない", async () => {
    const suggestionStore = await import("./suggestion-store");
    await suggestionStore.createSuggestion("トップレベル提案", { agentRunId: "run-1" });
    const rt = await loadModule();
    const prompt = rt.buildSystemPrompt("Lead Agent", true, "run-1");
    expect(prompt).not.toContain("```sub_issues");
    expect(prompt).toContain("```suggestion_note");
  });

  it("子提案階層は廃止のためsub_issues説明は付かない", async () => {
    const suggestionStore = await import("./suggestion-store");
    await suggestionStore.createSuggestion("子提案", { agentRunId: "run-1" });
    const rt = await loadModule();
    expect(rt.buildSystemPrompt("Lead Agent", true, "run-1")).not.toContain("```sub_issues");
  });

  it("Issueに紐づかないrunにもsub_issuesの説明は付かない", async () => {
    const rt = await loadModule();
    const prompt = rt.buildSystemPrompt("Lead Agent", true, "run-without-issue");
    expect(prompt).not.toContain("```sub_issues");
  });

  it("charterブロック説明は付かない（メモ追記のみ）", async () => {
    const suggestionStore = await import("./suggestion-store");
    await suggestionStore.createSuggestion("提案", { agentRunId: "run-1" });
    const rt = await loadModule();
    const prompt = rt.buildSystemPrompt("Lead Agent", true, "run-1");
    expect(prompt).not.toContain("```charter");
    expect(prompt).toContain("```suggestion_note");
  });

  it("Why/What/Howメモがあってもcharterブロック説明は付かない", async () => {
    const suggestionStore = await import("./suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("提案", { agentRunId: "run-1" });
    await suggestionStore.updateSuggestionCharter(suggestion.id, { why: "w1", what: "w2", how: "w3" });
    const rt = await loadModule();
    expect(rt.buildSystemPrompt("Lead Agent", true, "run-1")).not.toContain("```charter");
  });

  it("Issueに紐づかないrunにもcharterブロックの説明は付かない", async () => {
    const rt = await loadModule();
    expect(rt.buildSystemPrompt("Lead Agent", true, "run-without-issue")).not.toContain("```charter");
  });

  it("origin=auto-weekly-report/auto-monthly-reportのときだけperiod_review材料を注入する", async () => {
    const rt = await loadModule();
    const weekly = await rt.startPeriodReviewAnalysis("week", 0, {});
    expect(weekly).toBeDefined();
    const weeklyPrompt = rt.buildSystemPrompt("Lead Agent", true, weekly!.run.id);
    expect(weeklyPrompt).toContain("```period_review");
    expect(weeklyPrompt).toContain("【対象期間】");

    const monthly = await rt.startPeriodReviewAnalysis("month", 0, {});
    expect(monthly).toBeDefined();
    expect(rt.buildSystemPrompt("Lead Agent", true, monthly!.run.id)).toContain("```period_review");

    const manualRun = await rt.startRun("Lead Agent", "何か別件", "manual");
    expect(rt.buildSystemPrompt("Lead Agent", true, manualRun.id)).not.toContain("```period_review");
  });

  it("前回の同originレビューのnextQuestionsを次回の材料へ持ち越す", async () => {
    const { getDb } = await import("./db");
    const now = Date.now();
    getDb()
      .prepare(
        `INSERT INTO agent_runs (id, agent_name, task, status, origin, created_at, updated_at, reviewed, total_cost_usd, period_review_json)
         VALUES (?, 'Lead Agent', 'seed', 'idle', 'auto-weekly-report', ?, ?, 1, 0, ?)`,
      )
      .run(
        "seed-weekly-report",
        now - 7 * 24 * 60 * 60 * 1000,
        now - 7 * 24 * 60 * 60 * 1000,
        JSON.stringify({
          overview: "先週の概観",
          observations: [],
          interpretation: "先週の解釈",
          comparisons: [],
          blindSpots: [],
          learnings: [],
          nextQuestions: ["判断待ちが減ったか来週も見る"],
        }),
      );
    const rt = await loadModule();
    const weekly = await rt.startPeriodReviewAnalysis("week", 0, {});
    const prompt = rt.buildSystemPrompt("Lead Agent", true, weekly!.run.id);
    expect(prompt).toContain("判断待ちが減ったか来週も見る");
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
      suggested_sub_suggestions_json: null,
      suggested_charter_json: null,
      suggested_priority_json: null,
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
        (id, agent_name, task, status, session_id, agy_conversation_id, cursor_session_id, yield_request_json, proposal_json, suggested_action_items_json, suggested_sub_suggestions_json, suggested_charter_json, suggested_priority_json, suggested_suggestion_notes_json, suggested_suggestion_updates_json, total_cost_usd, created_at, updated_at, consulted_by, origin, reviewed, triage_status, triage_at)
       VALUES (@id, @agent_name, @task, @status, @session_id, @agy_conversation_id, @cursor_session_id, @yield_request_json, @proposal_json, @suggested_action_items_json, @suggested_sub_suggestions_json, @suggested_charter_json, @suggested_priority_json, @suggested_suggestion_notes_json, @suggested_suggestion_updates_json, @total_cost_usd, @created_at, @updated_at, @consulted_by, @origin, @reviewed, @triage_status, @triage_at)`,
    ).run(base);
  }

  it("起動時に'active'/'queued'で残っていたrunは'error'へ復旧される（サーバー再起動想定）", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), { id: "run-active", status: "active" });
    insertRunRow(getDb(), { id: "run-queued", status: "queued" });
    const rt = await loadModule();
    expect(rt.getRun("run-active")?.status).toBe("error");
    expect(rt.getRun("run-queued")?.status).toBe("error");
    expect(rt.getRun("run-active")?.log.some((l) => l.text.includes("実行状態が不明になった"))).toBe(true);
  });

  it("'idle'/'yield'/'error'で残っていたrunはそのままの状態で復元される", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), { id: "run-idle", status: "idle" });
    const rt = await loadModule();
    expect(rt.getRun("run-idle")?.status).toBe("idle");
  });

  it("listRunsは作成日時の新しい順で返す", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), { id: "run-old", created_at: 1 });
    insertRunRow(getDb(), { id: "run-new", created_at: 100 });
    const rt = await loadModule();
    expect(rt.listRuns().map((r) => r.id)).toEqual(["run-new", "run-old"]);
  });

  it("listRunsPageはフィルタ・ページングした結果とtotalを返す", async () => {
    const { getDb } = await import("./db");
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
    const { getDb } = await import("./db");
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
    const peopleDirectory = await import("./people-directory");
    const id = peopleDirectory.registerName("Aさん");
    const { getDb } = await import("./db");
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
    const { getDb } = await import("./db");
    insertRunRow(getDb(), { id: "run-1", reviewed: 0 });
    const rt = await loadModule();
    expect(rt.getRun("run-1")?.reviewed).toBe(false);
    const updated = rt.markRunReviewed("run-1");
    expect(updated?.reviewed).toBe(true);
  });

  it("setRunTriageStatusはtriageStatus/triageAt/reviewedを設定する", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), { id: "run-1", reviewed: 0 });
    const rt = await loadModule();
    const updated = rt.setRunTriageStatus("run-1", "watching");
    expect(updated?.triageStatus).toBe("watching");
    expect(updated?.reviewed).toBe(true);
    expect(updated?.triageAt).toBeDefined();
    expect(updated?.triageNextReviewAt).toBeUndefined();
  });

  it("setRunTriageStatusは様子見時にnextReviewAtを記録できる", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), { id: "run-1", reviewed: 0 });
    const rt = await loadModule();
    const next = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const updated = rt.setRunTriageStatus("run-1", "watching", { nextReviewAt: next });
    expect(updated?.triageNextReviewAt).toBe(next);
  });

  it("setRunTriageStatusはconsult子runにも同じトリアージを伝播する", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), { id: "lead-1", reviewed: 0 });
    insertRunRow(getDb(), { id: "spec-1", agent_name: "People Agent", consulted_by: "lead-1", reviewed: 0 });
    const rt = await loadModule();
    rt.setRunTriageStatus("lead-1", "dismissed");
    expect(rt.getRun("lead-1")?.triageStatus).toBe("dismissed");
    expect(rt.getRun("spec-1")?.triageStatus).toBe("dismissed");
    expect(rt.getRun("spec-1")?.reviewed).toBe(true);
  });

  it("setRunArchivedはarchivedAtを設定・解除する（triageStatusとは独立）", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), { id: "run-1", triage_status: "watching" });
    const rt = await loadModule();

    const archived = rt.setRunArchived("run-1", true);
    expect(archived?.archivedAt).toBeTypeOf("number");
    expect(archived?.triageStatus).toBe("watching");
    expect(rt.getRun("run-1")?.archivedAt).toBeTypeOf("number");

    const unarchived = rt.setRunArchived("run-1", false);
    expect(unarchived?.archivedAt).toBeUndefined();
    expect(rt.getRun("run-1")?.archivedAt).toBeUndefined();
  });

  it("clearSuggestedSuggestionNotesは提案を消す", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), {
      id: "run-1",
      suggested_suggestion_notes_json: JSON.stringify([{ suggestionId: "issue-1", text: "メモ" }]),
    });
    const rt = await loadModule();
    expect(rt.getRun("run-1")?.suggestedSuggestionNotes).toEqual([{ suggestionId: "issue-1", text: "メモ" }]);
    rt.clearSuggestedSuggestionNotes("run-1");
    expect(rt.getRun("run-1")?.suggestedSuggestionNotes).toBeUndefined();
  });

  it("adoptSuggestedSuggestionNotesFromRunは対象Issueのlogへ追記し、提案を消す", async () => {
    const suggestionStore = await import("./suggestion-store");
    const issue = await suggestionStore.createSuggestion("対象Issue");
    const { getDb } = await import("./db");
    insertRunRow(getDb(), {
      id: "run-1",
      suggested_suggestion_notes_json: JSON.stringify([{ suggestionId: issue.id, text: "見つけた事実" }]),
    });
    const rt = await loadModule();
    const result = await rt.adoptSuggestedSuggestionNotesFromRun("run-1");
    expect(result?.written).toEqual([{ suggestionId: issue.id, text: "見つけた事実" }]);
    expect(result?.skipped).toEqual([]);
    expect(rt.getRun("run-1")?.suggestedSuggestionNotes).toBeUndefined();
    const updated = suggestionStore.getSuggestion(issue.id);
    expect(updated?.memos.map((l) => l.text)).toEqual(["見つけた事実"]);
    expect(updated?.memos.map((l) => l.source)).toEqual(["agent"]);
  });

  it("adoptSuggestedSuggestionNotesFromRunは存在しないsuggestionIdをスキップする", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), {
      id: "run-1",
      suggested_suggestion_notes_json: JSON.stringify([{ suggestionId: "no-such-suggestion-id", text: "メモ" }]),
    });
    const rt = await loadModule();
    const result = await rt.adoptSuggestedSuggestionNotesFromRun("run-1");
    expect(result?.written).toEqual([]);
    expect(result?.skipped).toEqual(["no-such-suggestion-id"]);
  });

  it("adoptSuggestedSuggestionNotesFromRunは提案が無ければundefinedを返す", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), { id: "run-1" });
    const rt = await loadModule();
    expect(await rt.adoptSuggestedSuggestionNotesFromRun("run-1")).toBeUndefined();
  });

  it("clearSuggestedSuggestionUpdatesは提案を消す", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), {
      id: "run-1",
      suggested_suggestion_updates_json: JSON.stringify([
        { suggestionId: "s-1", reviewStatus: "done", reason: "対応済み" },
      ]),
    });
    const rt = await loadModule();
    expect(rt.getRun("run-1")?.suggestedSuggestionUpdates).toEqual([
      { suggestionId: "s-1", reviewStatus: "done", reason: "対応済み" },
    ]);
    rt.clearSuggestedSuggestionUpdates("run-1");
    expect(rt.getRun("run-1")?.suggestedSuggestionUpdates).toBeUndefined();
  });

  it("adoptSuggestionUpdatesFromRunは指定フィールドをSuggestionへ反映し、提案を消す", async () => {
    const suggestionStore = await import("./suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案");
    const { getDb } = await import("./db");
    insertRunRow(getDb(), {
      id: "run-1",
      suggested_suggestion_updates_json: JSON.stringify([
        {
          suggestionId: suggestion.id,
          reviewStatus: "done",
          confirmPriority: "parked",
          note: "整理済み",
          reason: "重複のため",
        },
      ]),
    });
    const rt = await loadModule();
    const result = await rt.adoptSuggestionUpdatesFromRun("run-1");
    expect(result?.applied).toEqual([{ suggestionId: suggestion.id, reason: "重複のため" }]);
    expect(result?.skipped).toEqual([]);
    expect(rt.getRun("run-1")?.suggestedSuggestionUpdates).toBeUndefined();
    const updated = suggestionStore.getSuggestion(suggestion.id);
    expect(updated?.reviewStatus).toBe("done");
    expect(updated?.confirmPriority).toBe("parked");
    expect(updated?.memos.map((m) => m.text)).toEqual(["整理済み"]);
    expect(updated?.memos.map((m) => m.source)).toEqual(["agent"]);
  });

  it("adoptSuggestionUpdatesFromRunはarchived/reviewDueAtも反映する", async () => {
    const suggestionStore = await import("./suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案2");
    const dueAt = Date.now() + 86_400_000;
    const { getDb } = await import("./db");
    insertRunRow(getDb(), {
      id: "run-1",
      suggested_suggestion_updates_json: JSON.stringify([
        { suggestionId: suggestion.id, archived: true, reviewDueAt: dueAt, reason: "重複のためアーカイブ" },
      ]),
    });
    const rt = await loadModule();
    await rt.adoptSuggestionUpdatesFromRun("run-1");
    const updated = suggestionStore.getSuggestion(suggestion.id);
    expect(updated?.archivedAt).toBeTypeOf("number");
    expect(updated?.reviewDueAt).toBe(dueAt);
  });

  it("adoptSuggestionUpdatesFromRunは存在しないsuggestionIdをスキップする", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), {
      id: "run-1",
      suggested_suggestion_updates_json: JSON.stringify([
        { suggestionId: "no-such-suggestion-id", reviewStatus: "done", reason: "x" },
      ]),
    });
    const rt = await loadModule();
    const result = await rt.adoptSuggestionUpdatesFromRun("run-1");
    expect(result?.applied).toEqual([]);
    expect(result?.skipped).toEqual(["no-such-suggestion-id"]);
  });

  it("adoptSuggestionUpdatesFromRunは提案が無ければundefinedを返す", async () => {
    const { getDb } = await import("./db");
    insertRunRow(getDb(), { id: "run-1" });
    const rt = await loadModule();
    expect(await rt.adoptSuggestionUpdatesFromRun("run-1")).toBeUndefined();
  });

  // noteの追記は
  // addMemoにonUpdatedを渡さないため、autoSuggestionUpdateAnalysisEnabledがONでも
  // auto-suggestion-update分析を裏で起動してはならない。
  it("adoptSuggestionUpdatesFromRunのnote追記はauto-suggestion-update分析を起動しない", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ autoSuggestionUpdateAnalysisEnabled: true });
    const suggestionStore = await import("./suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案3");
    const { getDb } = await import("./db");
    insertRunRow(getDb(), {
      id: "run-1",
      suggested_suggestion_updates_json: JSON.stringify([
        { suggestionId: suggestion.id, note: "整理メモ", reason: "テスト" },
      ]),
    });
    const rt = await loadModule();
    rt.setSuggestionUpdateDebounceMsForTest(0);
    await rt.adoptSuggestionUpdatesFromRun("run-1");
    await new Promise((r) => setTimeout(r, 10));
    expect(rt.listPendingAgentStarts()).toHaveLength(0);
    expect(rt.listRuns().filter((r) => r.origin === "auto-suggestion-update")).toHaveLength(0);
  });

  it("存在しないIDへの操作はundefinedを返す", async () => {
    const rt = await loadModule();
    expect(rt.markRunReviewed("missing")).toBeUndefined();
    expect(rt.setRunTriageStatus("missing", "dismissed")).toBeUndefined();
    expect(rt.setRunArchived("missing", true)).toBeUndefined();
    expect(rt.getRun("missing")).toBeUndefined();
  });

  it("専門Agent runはconsultedByの親提案コンテキスト（メモ）を使う", async () => {
    const suggestionStore = await import("./suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("障害対応", { agentRunId: "lead-1" });
    await suggestionStore.updateSuggestionCharter(suggestion.id, { why: "顧客影響を止める", what: "原因特定", how: "ログ調査" });
    const { getDb } = await import("./db");
    insertRunRow(getDb(), { id: "lead-1" });
    insertRunRow(getDb(), { id: "spec-1", agent_name: "People Agent", consulted_by: "lead-1" });
    const rt = await loadModule();
    expect(rt.buildSuggestionContextBlock("spec-1")).toContain("顧客影響を止める");
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

  // 過去のナレッジイベントが
  // 類似検索等でsystemPromptに含まれても、過去データを勝手に自動アーカイブしない。
  it("過去のナレッジイベントを自動アーカイブせず、入力テキストのみを確認対象とする", async () => {
    const pd = await import("./people-directory");
    const ks = await import("./knowledge-store");
    pd.registerName("漏洩太郎");
    const pastEvent = ks.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "漏洩太郎さんが辞めたいと言っていた",
      tags: [],
      occurredAt: Date.now(),
      embedding: [1, 0, 0],
    });
    // 類似検索がヒットするように設定
    cosineSimilarityRef.impl = () => 0.9;

    const rt = await loadModule();
    const run = await rt.startRun(
      "Lead Agent",
      '対象のJournalエントリ: "1on1が空回りした"',
      "auto-anomaly",
    );

    // 過去データが関連コンテキストに含まれても勝手に自動アーカイブされず実行される
    await waitForSpawnCount(1);
    expect(spawnCalls).toHaveLength(1);
    emitClaudeResult(spawnCalls[0].child, {
      text: '```proposal\n{ "conclusion": "1on1を継続", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(spawnCalls[0].child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    const finished = rt.getRun(run.id)!;
    expect(finished.status).toBe("idle");
    expect(finished.proposal?.conclusion).toBe("1on1を継続");
    // 過去のナレッジイベントは勝手にアーカイブされずに残る
    expect(ks.getEventById(pastEvent.id)?.archivedAt).toBeUndefined();
  });

  it("相談の入力テキストに未登録の人名候補がある場合はUnconfirmedNameCandidatesErrorをスローし、ユーザー確認で実行できる", async () => {
    nameCandidateDetectRef.detectNameCandidatesAsync = async () => ["佐藤"];
    const { UnconfirmedNameCandidatesError } = await import("./name-candidate-confirmation");
    const rt = await loadModule();

    // 未確認の人名候補が含まれ、確認前の状態（allowUnmaskedCandidates: false）の場合、startRunは拒絶する
    await expect(
      rt.startRun("Lead Agent", "佐藤さんと1on1を実施した", "manual", undefined, {
        allowUnmaskedCandidates: false,
      }),
    ).rejects.toThrow(UnconfirmedNameCandidatesError);

    const run = await rt.startRun("Lead Agent", "佐藤さんと1on1を実施した", "manual", undefined, {
      allowUnmaskedCandidates: true,
    });
    expect(run).toBeDefined();
    expect(run.status).toBe("active");
  });

  it("auto-anomalyでrecommendation:dismissなら自動却下する", async () => {
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "Journalの内容", "auto-anomaly");
    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      text: '```proposal\n{ "conclusion": "一時的な感情なので追跡不要", "facts": [], "logic": "l", "rejectedAlternatives": [], "recommendation": "dismiss" }\n```',
    });
    closeChild(spawnCalls[0].child, 0);
    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.triageStatus !== "dismissed") throw new Error("not dismissed");
    });
    expect(rt.getRun(run.id)?.reviewed).toBe(true);
  });

  it("startJournalAnalysisはsourceJournalIdを保存する", async () => {
    const rt = await loadModule();
    const run = await rt.startJournalAnalysis("現場が疲弊している", "journal-1");
    expect(run?.sourceJournalId).toBe("journal-1");
    expect(rt.getRun(run!.id)?.sourceJournalId).toBe("journal-1");
  });

  it("buildJournalAnalysisTaskは本文マーカーを残す", async () => {
    const rt = await loadModule();
    const task = rt.buildJournalAnalysisTask("1on1が空回りした");
    expect(task).toContain("EMがこのJournalエントリの分析を依頼しました");
    expect(rt.extractJournalAutoAnalysisText(task)).toBe("1on1が空回りした");
  });

  it("設定でエージェント種別にモデル系統が指定されていれば--modelを渡す", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ agentModelTiers: { "Lead Agent": "opus" } });
    const rt = await loadModule();
    await rt.startRun("Lead Agent", "障害対応の方針を決めたい");

    await waitForSpawnCount(1);
    expect(spawnCalls[0].args).toContain("--model");
    expect(spawnCalls[0].args[spawnCalls[0].args.indexOf("--model") + 1]).toBe("opus");
  });

  it("設定のperTurnBudgetUsdを--max-budget-usdに渡す", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ perTurnBudgetUsd: 2 });
    const rt = await loadModule();
    await rt.startRun("Lead Agent", "予算を上げたい");
    await waitForSpawnCount(1);
    expect(spawnCalls[0].args[spawnCalls[0].args.indexOf("--max-budget-usd") + 1]).toBe("2");
  });

  it("perTurnBudgetUsd未設定時は--max-budget-usdに既定の0.5を渡す", async () => {
    const rt = await loadModule();
    await rt.startRun("Lead Agent", "既定予算");
    await waitForSpawnCount(1);
    expect(spawnCalls[0].args[spawnCalls[0].args.indexOf("--max-budget-usd") + 1]).toBe("0.5");
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

  it("claude失敗→agyが候補に含まれていれば起動し、成功すればidleになる", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["claude", "agy"] });
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
    expect(finished.log.some((l) => l.text.includes("Claude Code CLIが利用できなかったため、agy（Gemini）にこのターンをフォールバック"))).toBe(true);
  });

  it("claude失敗→agyを含まずcursorが候補に含まれていれば起動し、成功すればidleになる", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["claude", "cursor"] });
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
    expect(finished.log.some((l) => l.text.includes("Claude Code CLIが利用できなかったため、Cursor CLIにこのターンをフォールバック"))).toBe(true);
  });

  it("claude失敗→agyも失敗→cursorが候補にあれば3段目として起動し成功する", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["claude", "agy", "cursor"] });
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

  // cliOrder（全エージェント共通の単一CLI優先順位）へ統合し、claudeも他と同様に
  // 除外できるようにした後の挙動を検証する。
  it("cliOrderにclaudeを含めなければ、claudeは一度も起動されずagyから始まる", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["agy", "cursor"] });
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "タスク");

    await waitForSpawnCount(1);
    expect(spawnCalls[0].command).toBe("agy");
    emitAgyResult(spawnCalls[0].child, { text: "agyの結論" });
    closeChild(spawnCalls[0].child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    expect(rt.getRun(run.id)?.status).toBe("idle");
    expect(spawnCalls.every((c) => c.command !== "claude")).toBe(true);
  });

  it("cliOrderでcursorをclaudeより先に並べると、cursorが最初に起動する", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["cursor", "claude", "agy"] });
    const rt = await loadModule();
    await rt.startRun("Lead Agent", "タスク");

    await waitForSpawnCount(1);
    expect(spawnCalls[0].command).toBe("cursor-agent");
  });

  it("cliOrderは全エージェント種別に共通で適用される", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["cursor", "agy", "claude"] });
    const rt = await loadModule();
    await rt.startRun("People Agent", "タスク");

    await waitForSpawnCount(1);
    expect(spawnCalls[0].command).toBe("cursor-agent");
  });

  it("cursorを先頭にして失敗した場合、次の候補（agy）へフォールバックする", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["cursor", "agy", "claude"] });
    const rt = await loadModule();
    const run = await rt.startRun("Lead Agent", "落ちるタスク");

    await waitForSpawnCount(1);
    expect(spawnCalls[0].command).toBe("cursor-agent");
    closeChild(spawnCalls[0].child, 1);

    await waitForSpawnCount(2);
    expect(spawnCalls[1].command).toBe("agy");
    emitAgyResult(spawnCalls[1].child, { text: "agyで復旧" });
    closeChild(spawnCalls[1].child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });
    const finished = rt.getRun(run.id)!;
    expect(finished.status).toBe("idle");
    expect(finished.log.some((l) => l.text.includes("Cursor CLIが利用できなかったため、agy（Gemini）にこのターンをフォールバック"))).toBe(
      true,
    );
  });

  it("agentAgyModelsでこのエージェント種別のモデルを指定すると、agy起動時にそのモデルを渡す", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({
      cliOrder: ["claude", "agy"],
      agentAgyModels: { "Lead Agent": "gemini-custom-model" },
    });
    const rt = await loadModule();
    await rt.startRun("Lead Agent", "落ちるタスク");

    await waitForSpawnCount(1);
    closeChild(spawnCalls[0].child, 1);
    await waitForSpawnCount(2);
    expect(spawnCalls[1].command).toBe("agy");
    expect(spawnCalls[1].args[spawnCalls[1].args.indexOf("--model") + 1]).toBe("gemini-custom-model");
  });

  it("agentAgyModelsが未設定のエージェントは既定モデルのままagyを起動する", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["claude", "agy"] });
    const rt = await loadModule();
    await rt.startRun("Lead Agent", "落ちるタスク");

    await waitForSpawnCount(1);
    closeChild(spawnCalls[0].child, 1);
    await waitForSpawnCount(2);
    expect(spawnCalls[1].args[spawnCalls[1].args.indexOf("--model") + 1]).toBe("gemini-3.6-flash-medium");
  });

  it("agentCursorModelsでこのエージェント種別のモデルを指定すると、cursor-agent起動時にそのモデルを渡す", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({
      cliOrder: ["claude", "cursor"],
      agentCursorModels: { "Lead Agent": "gpt-custom" },
    });
    const rt = await loadModule();
    await rt.startRun("Lead Agent", "落ちるタスク");

    await waitForSpawnCount(1);
    closeChild(spawnCalls[0].child, 1);
    await waitForSpawnCount(2);
    expect(spawnCalls[1].command).toBe("cursor-agent");
    expect(spawnCalls[1].args[spawnCalls[1].args.indexOf("--model") + 1]).toBe("gpt-custom");
  });

  it("claude/agy/cursorすべて失敗すればerrorのまま確定する", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ cliOrder: ["claude", "agy", "cursor"] });
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
    const settingsStore = await import("./settings-store");
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
  it("requiredConsultAgents指定時、Leadがproposalだけ返してもExec Agentへ強制consultする", async () => {
    const rt = await loadModule();
    const leadRun = await rt.startRun("Lead Agent", "MVVに照らして方針を見直したい", "manual", undefined, {
      requiredConsultAgents: ["Exec Agent"],
    });

    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      sessionId: "sess-lead-exec",
      text: '```proposal\n{ "conclusion": "このまま進める", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(spawnCalls[0].child, 0);

    await vi.waitFor(() => {
      if (rt.listRuns().length < 2) throw new Error("exec run not created yet");
    });
    const execRun = rt.listRuns().find((r) => r.agentName === "Exec Agent")!;
    expect(execRun.consultedBy).toBe(leadRun.id);
    expect(rt.getRun(leadRun.id)?.log.some((l) => l.text.includes("[必須相談]"))).toBe(true);

    await waitForSpawnCount(2);
    const execCall = spawnCalls[1];
    emitAssistantText(execCall.child, "Execとしての厳しい見解");
    emitClaudeResult(execCall.child, { text: "Execとしての厳しい見解" });
    closeChild(execCall.child, 0);

    await waitForSpawnCount(3);
    const followUp = spawnCalls[2];
    const followPrompt = followUp.args[followUp.args.indexOf("-p") + 1];
    expect(followPrompt).toContain("Execとしての厳しい見解");

    emitClaudeResult(followUp.child, {
      text: '```proposal\n{ "conclusion": "Exec見解を踏まえた結論", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(followUp.child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(leadRun.id)?.status === "active") throw new Error("still active");
    });
    expect(rt.getRun(leadRun.id)?.status).toBe("idle");
    expect(rt.getRun(leadRun.id)?.proposal?.conclusion).toBe("Exec見解を踏まえた結論");
  });

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
    // それぞれのconsultQuestionForによる個別質問がtaskに反映されている。
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
    const settingsStore = await import("./settings-store");
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
    const settingsStore = await import("./settings-store");
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
    const settingsStore = await import("./settings-store");
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
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ autoMorningSummaryEnabled: true, autoMorningSummaryHour: 24 });
    const rt = await loadModule();
    rt.checkMorningSummary();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
  });

  it("設定時刻に達していれば当日1回だけLead Agentを自動起動する", async () => {
    // hour:0にすることで「今日中は常に到達済み」を実時刻に依存せず再現する。
    const settingsStore = await import("./settings-store");
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

  it("メモリ上のクレームを忘れていても、当日の既存auto-summaryがあれば再起動しない", async () => {
    // 実機の HMR レース: クレーム変数は消えたが DB に今日の run が残っている状態。
    const settingsStore = await import("./settings-store");
    const { saveJSON } = await import("./persistence");
    settingsStore.updateRulesAndConstraints({ autoMorningSummaryEnabled: true, autoMorningSummaryHour: 0 });
    const rt = await loadModule();

    rt.checkMorningSummary();
    await vi.waitFor(() => {
      if (rt.listRuns().length < 1) throw new Error("run not created yet");
    });
    expect(rt.listRuns()).toHaveLength(1);

    // ファイルクレームとメモリクレームを消すが、run はそのまま。
    saveJSON("auto-morning-summary.json", { date: null });
    rt.clearAutoBatchClaimsForTest();

    rt.checkMorningSummary();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(1);
    expect(spawnCalls).toHaveLength(1);
  });

  it("連続で呼び出しても当日は1件しか作らない（クレームの先取り）", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ autoMorningSummaryEnabled: true, autoMorningSummaryHour: 0 });
    const rt = await loadModule();

    rt.checkMorningSummary();
    rt.checkMorningSummary();
    rt.checkMorningSummary();
    await vi.waitFor(() => {
      if (rt.listRuns().length < 1) throw new Error("run not created yet");
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(rt.listRuns().filter((r) => r.origin === "auto-summary")).toHaveLength(1);
  });

  // 同じデータディレクトリを見る構成では、globalThis／JSON永続化／DB run確認の
  // 「読み取り→書き込み」の組み合わせだけではTOCTOUを防げない（2026-09-19、2プロセスを
  // 実機起動して実際に重複起動を再現・確認した）。auto_batch_claimsテーブルへの原子的
  // INSERTが最終防波堤として機能することを、他の3層のガードを素通りする状況を直接
  // 作って確認する。
  it("他プロセスがauto_batch_claimsを先取りしていれば、他のガード層を素通りしてもstartRunを呼ばない", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ autoMorningSummaryEnabled: true, autoMorningSummaryHour: 0 });
    const rt = await loadModule();
    const { getDb } = await import("./db");
    const today = rt.todayDateString(new Date());
    // globalThisのクレーム・JSON永続化・DB run確認のいずれもまだ「未クレーム」の
    // 状態のまま、auto_batch_claimsだけ他プロセスが先に取得済みという状況を再現する。
    getDb()
      .prepare("INSERT INTO auto_batch_claims (claim_key, claimed_at) VALUES (?, ?)")
      .run(`auto-summary:${today}`, Date.now());

    rt.checkMorningSummary();
    await new Promise((r) => setTimeout(r, 20));
    expect(rt.listRuns()).toHaveLength(0);
    expect(spawnCalls).toHaveLength(0);
  });
});

describe("watchdog: checkWeeklyDistillation", () => {
  it("選択曜日でなければ起動しない", async () => {
    const settingsStore = await import("./settings-store");
    const otherWeekday = (new Date().getDay() + 1) % 7;
    settingsStore.updateRulesAndConstraints({
      autoDistillationEnabled: true,
      autoDistillationWeekdays: [otherWeekday],
      autoDistillationHour: 0,
    });
    const rt = await loadModule();
    rt.checkWeeklyDistillation();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
  });

  it("選択曜日・時刻なら起動し、同じ曜日では再起動しない", async () => {
    const settingsStore = await import("./settings-store");
    const today = new Date().getDay();
    settingsStore.updateRulesAndConstraints({
      autoDistillationEnabled: true,
      autoDistillationWeekdays: [today, (today + 2) % 7],
      autoDistillationHour: 0,
    });
    const rt = await loadModule();
    rt.checkWeeklyDistillation();
    await vi.waitFor(() => {
      if (rt.listRuns().length < 1) throw new Error("run not created yet");
    });
    expect(rt.listRuns()[0].origin).toBe("auto-distill");
    rt.checkWeeklyDistillation();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns().filter((r) => r.origin === "auto-distill")).toHaveLength(1);
  });

  it("旧形式 { week } のみでも他曜日の実行は潰さず、未実行の選択曜日なら起動する", async () => {
    const settingsStore = await import("./settings-store");
    const { saveJSON } = await import("./persistence");
    const { getDb } = await import("./db");

    // isoWeekKey と同じ算法（agent-runtime 読込前に週キーを決めるため）
    const isoWeek = (now: Date): string => {
      const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    };

    const now = new Date();
    const today = now.getDay();
    const week = isoWeek(now);
    let earlier: Date | null = null;
    for (let i = 1; i <= 6; i++) {
      const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      if (candidate.getDay() === today) continue;
      if (isoWeek(candidate) !== week) continue;
      earlier = candidate;
      break;
    }
    // 週初（月曜など）で同一 ISO 週内に「別曜日」が取れない場合はスキップ相当。
    if (!earlier) {
      settingsStore.updateRulesAndConstraints({ autoDistillationEnabled: false });
      return;
    }

    saveJSON("auto-distillation.json", { week });
    const earlierMs = new Date(
      earlier.getFullYear(),
      earlier.getMonth(),
      earlier.getDate(),
      8,
      0,
      0,
      0,
    ).getTime();
    getDb()
      .prepare(
        `INSERT INTO agent_runs (id, agent_name, task, status, origin, created_at, updated_at, reviewed, total_cost_usd)
         VALUES (?, 'Lead Agent', 'seed', 'idle', 'auto-distill', ?, ?, 0, 0)`,
      )
      .run("seed-distill-earlier-day", earlierMs, earlierMs);

    settingsStore.updateRulesAndConstraints({
      autoDistillationEnabled: true,
      autoDistillationWeekdays: [earlier.getDay(), today],
      autoDistillationHour: 0,
    });
    const rt = await loadModule();
    rt.clearAutoBatchClaimsForTest();
    rt.checkWeeklyDistillation();
    await vi.waitFor(() => {
      const distillRuns = rt.listRuns().filter((r) => r.origin === "auto-distill");
      if (distillRuns.length < 2) throw new Error("later weekday not started yet");
    });
    expect(rt.listRuns().filter((r) => r.origin === "auto-distill")).toHaveLength(2);
  });
});

describe("watchdog: checkWeeklyGrow", () => {
  it("autoGrowEnabledが既定(false)なら何もしない", async () => {
    const rt = await loadModule();
    rt.checkWeeklyGrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
  });

  it("曜日が一致しなければ起動しない", async () => {
    const settingsStore = await import("./settings-store");
    const otherWeekday = (new Date().getDay() + 1) % 7;
    settingsStore.updateRulesAndConstraints({ autoGrowEnabled: true, autoGrowWeekday: otherWeekday, autoGrowHour: 0 });
    const rt = await loadModule();
    rt.checkWeeklyGrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
  });

  it("曜日・時刻が一致すればLead Agentを自動起動し、grow_suggestionsをem-growth-storeへ保存する", async () => {
    const settingsStore = await import("./settings-store");
    const growStore = await import("./em-growth-store");
    settingsStore.updateRulesAndConstraints({
      autoGrowEnabled: true,
      autoGrowWeekday: new Date().getDay(),
      autoGrowHour: 0,
    });
    const rt = await loadModule();

    rt.checkWeeklyGrow();
    await vi.waitFor(() => {
      if (rt.listRuns().length < 1) throw new Error("run not created yet");
    });
    const run = rt.listRuns()[0];
    expect(run.origin).toBe("auto-grow");
    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      text: '```grow_suggestions\n[{ "title": "学びA", "rationale": "根拠A", "references": [] }]\n```',
    });
    closeChild(spawnCalls[0].child, 0);
    await vi.waitFor(() => {
      if (growStore.listGrowSuggestions().length < 1) throw new Error("grow suggestion not saved yet");
    });
    expect(growStore.listGrowSuggestions()[0].title).toBe("学びA");
    expect(growStore.listGrowSuggestions()[0].sourceRunId).toBe(run.id);

    // 同週の再呼び出しでは再度起動しない（重複生成の防止）。
    rt.checkWeeklyGrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(1);
    expect(spawnCalls).toHaveLength(1);
  });
});

describe("watchdog: checkWeeklyReport", () => {
  it("autoWeeklyReportEnabledが既定(false)なら何もしない", async () => {
    const rt = await loadModule();
    rt.checkWeeklyReport();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
  });

  it("曜日が一致しなければ起動しない", async () => {
    const settingsStore = await import("./settings-store");
    const otherWeekday = (new Date().getDay() + 1) % 7;
    settingsStore.updateRulesAndConstraints({
      autoWeeklyReportEnabled: true,
      autoWeeklyReportWeekday: otherWeekday,
      autoWeeklyReportHour: 0,
    });
    const rt = await loadModule();
    rt.checkWeeklyReport();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
  });

  it("曜日・時刻が一致すればLead Agentを自動起動し、同週の再呼び出しでは再起動しない", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({
      autoWeeklyReportEnabled: true,
      autoWeeklyReportWeekday: new Date().getDay(),
      autoWeeklyReportHour: 0,
    });
    const rt = await loadModule();
    rt.checkWeeklyReport();
    await vi.waitFor(() => {
      if (rt.listRuns().length < 1) throw new Error("run not created yet");
    });
    expect(rt.listRuns()[0].origin).toBe("auto-weekly-report");
    rt.checkWeeklyReport();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns().filter((r) => r.origin === "auto-weekly-report")).toHaveLength(1);
    expect(spawnCalls).toHaveLength(1);
  });
});

describe("watchdog: checkMonthlyReport", () => {
  it("autoMonthlyReportEnabledが既定(false)なら何もしない", async () => {
    const rt = await loadModule();
    rt.checkMonthlyReport();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
  });

  it("起動日が一致しなければ起動しない", async () => {
    const settingsStore = await import("./settings-store");
    const otherDay = (new Date().getDate() % 28) + 1;
    settingsStore.updateRulesAndConstraints({
      autoMonthlyReportEnabled: true,
      autoMonthlyReportDay: otherDay,
      autoMonthlyReportHour: 0,
    });
    const rt = await loadModule();
    rt.checkMonthlyReport();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
  });

  it("起動日・時刻が一致すればLead Agentを自動起動し、同月の再呼び出しでは再起動しない", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({
      autoMonthlyReportEnabled: true,
      autoMonthlyReportDay: new Date().getDate(),
      autoMonthlyReportHour: 0,
    });
    const rt = await loadModule();
    rt.checkMonthlyReport();
    await vi.waitFor(() => {
      if (rt.listRuns().length < 1) throw new Error("run not created yet");
    });
    expect(rt.listRuns()[0].origin).toBe("auto-monthly-report");
    rt.checkMonthlyReport();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns().filter((r) => r.origin === "auto-monthly-report")).toHaveLength(1);
    expect(spawnCalls).toHaveLength(1);
  });
});

describe("startJournalBatchAnalysis", () => {
  it("manual:trueならreviewed:trueで起動する（現場メモページの手動実行ボタン用）", async () => {
    const rt = await loadModule();
    const run = await rt.startJournalBatchAnalysis({ manual: true });
    expect(run?.origin).toBe("auto-journal-batch");
    expect(run?.reviewed).toBe(true);
  });
});

describe("watchdog: checkJournalBatchReview", () => {
  it("autoJournalBatchEnabledが既定(false)なら何もしない", async () => {
    const rt = await loadModule();
    rt.checkJournalBatchReview();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
    expect(spawnCalls).toHaveLength(0);
  });

  it("設定時刻に達していなければ起動しない", async () => {
    const settingsStore = await import("./settings-store");
    const futureHour = Math.min(23, new Date().getHours() + 1);
    // 現在が23時のときは「未来の時刻」が作れないので、空の due になるよう翌日扱いはせずスキップ相当の [23] のみ・かつ現在も23なら別手段。
    if (new Date().getHours() >= 23) {
      settingsStore.updateRulesAndConstraints({ autoJournalBatchEnabled: false });
      return;
    }
    settingsStore.updateRulesAndConstraints({
      autoJournalBatchEnabled: true,
      autoJournalBatchHours: [futureHour],
    });
    const rt = await loadModule();
    rt.checkJournalBatchReview();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
  });

  it("設定時刻に達していれば当日の過ぎたスロットをまとめて1回だけLead Agentを自動起動する", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ autoJournalBatchEnabled: true, autoJournalBatchHours: [0] });
    const rt = await loadModule();

    rt.checkJournalBatchReview();
    await vi.waitFor(() => {
      if (rt.listRuns().length < 1) throw new Error("run not created yet");
    });
    const run = rt.listRuns()[0];
    expect(run.agentName).toBe("Lead Agent");
    expect(run.origin).toBe("auto-journal-batch");
    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      text: '```proposal\n{ "conclusion": "追跡すべき問題なし", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(spawnCalls[0].child, 0);
    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status === "active") throw new Error("still active");
    });

    // 同日中の再呼び出しでは再度起動しない（重複生成の防止）。
    rt.checkJournalBatchReview();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(1);
    expect(spawnCalls).toHaveLength(1);
  });

  it("複数時刻が設定されていても、遅れ復帰時は過ぎたスロットをまとめて1回だけ起動する", async () => {
    const settingsStore = await import("./settings-store");
    const nowHour = new Date().getHours();
    settingsStore.updateRulesAndConstraints({
      autoJournalBatchEnabled: true,
      autoJournalBatchHours: [0, Math.min(nowHour, 12), nowHour].filter((h, i, a) => a.indexOf(h) === i),
    });
    const rt = await loadModule();
    rt.checkJournalBatchReview();
    await vi.waitFor(() => {
      if (rt.listRuns().length < 1) throw new Error("run not created yet");
    });
    expect(rt.listRuns()).toHaveLength(1);
    rt.checkJournalBatchReview();
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(1);
  });

  it("旧形式 { date } のみでも後続スロットは塞がず、朝の実行時刻より後のスロットは起動する", async () => {
    const settingsStore = await import("./settings-store");
    const { saveJSON } = await import("./persistence");
    const { getDb } = await import("./db");
    const now = new Date();
    const nowHour = now.getHours();
    // 現在が0時だと「朝より後のスロット」を作れないためスキップ相当。
    if (nowHour < 1) {
      settingsStore.updateRulesAndConstraints({ autoJournalBatchEnabled: false });
      return;
    }
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const morningMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 15, 0, 0).getTime();
    // 旧形式クレーム＋当日0時台の既存 run を DB に仕込み、複数時刻の後続が開くことを検証する。
    saveJSON("auto-journal-batch.json", { date: today });
    getDb()
      .prepare(
        `INSERT INTO agent_runs (id, agent_name, task, status, origin, created_at, updated_at, reviewed, total_cost_usd)
         VALUES (?, 'Lead Agent', 'seed', 'idle', 'auto-journal-batch', ?, ?, 0, 0)`,
      )
      .run("seed-journal-batch-morning", morningMs, morningMs);

    settingsStore.updateRulesAndConstraints({
      autoJournalBatchEnabled: true,
      autoJournalBatchHours: [0, nowHour],
    });
    const rt = await loadModule();
    rt.clearAutoBatchClaimsForTest();
    rt.checkJournalBatchReview();
    await vi.waitFor(() => {
      const batchRuns = rt.listRuns().filter((r) => r.origin === "auto-journal-batch");
      if (batchRuns.length < 2) throw new Error("later slot not started yet");
    });
    expect(rt.listRuns().filter((r) => r.origin === "auto-journal-batch")).toHaveLength(2);
  });

  it("recommendation:dismissなら自動却下する", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ autoJournalBatchEnabled: true, autoJournalBatchHours: [0] });
    const rt = await loadModule();

    rt.checkJournalBatchReview();
    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      text: '```proposal\n{ "conclusion": "一時的な感情のみで追跡不要", "facts": [], "logic": "l", "rejectedAlternatives": [], "recommendation": "dismiss" }\n```',
    });
    closeChild(spawnCalls[0].child, 0);
    const run = rt.listRuns()[0];
    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.triageStatus !== "dismissed") throw new Error("not dismissed");
    });
  });
});

describe("reactToSuggestionUpdate", () => {
  it("autoSuggestionUpdateAnalysisEnabledが既定(false)なら起動しない", async () => {
    const rt = await loadModule();
    rt.setSuggestionUpdateDebounceMsForTest(0);
    const suggestionStore = await import("./suggestion-store");
    const issue = await suggestionStore.createSuggestion("課題");
    rt.reactToSuggestionUpdate(issue.id, "charter", "Why");
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.listRuns()).toHaveLength(0);
  });

  it("ONかつ紐付きRunが無ければauto-suggestion-updateでLeadを起動しIssueに紐づける", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({
      autoSuggestionUpdateAnalysisEnabled: true,
      teamParallelKickoffEnabled: false,
    });
    const rt = await loadModule();
    rt.setSuggestionUpdateDebounceMsForTest(0);
    const suggestionStore = await import("./suggestion-store");
    const issue = await suggestionStore.createSuggestion("課題");

    rt.reactToSuggestionUpdate(issue.id, "charter", "Why・What");
    await vi.waitFor(() => {
      if (rt.listRuns().length < 1) throw new Error("run not created yet");
    });
    const run = rt.listRuns()[0];
    expect(run.origin).toBe("auto-suggestion-update");
    expect(run.agentName).toBe("Lead Agent");
    expect(suggestionStore.getSuggestion(issue.id)?.agentRunId).toBe(run.id);

    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      text: '```proposal\n{ "conclusion": "ok", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(spawnCalls[0].child, 0);
  });

  it("ONかつ紐付きRunがidleならdecideRunで継続する", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({
      autoSuggestionUpdateAnalysisEnabled: true,
      teamParallelKickoffEnabled: false,
    });
    const rt = await loadModule();
    rt.setSuggestionUpdateDebounceMsForTest(0);
    const suggestionStore = await import("./suggestion-store");

    const run = await rt.startRun("Lead Agent", "初期分析", "manual");
    await waitForSpawnCount(1);
    emitClaudeResult(spawnCalls[0].child, {
      text: '```proposal\n{ "conclusion": "初回", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(spawnCalls[0].child, 0);
    await vi.waitFor(() => {
      if (rt.getRun(run.id)?.status !== "idle") throw new Error("not idle yet");
    });

    const issue = await suggestionStore.createSuggestion("課題", { agentRunId: run.id });
    const spawnBefore = spawnCalls.length;
    rt.reactToSuggestionUpdate(issue.id, "log", "対応を始めた");
    await waitForSpawnCount(spawnBefore + 1);
    expect(rt.listRuns()).toHaveLength(1);
    const logText = rt.getRun(run.id)?.log.map((l) => l.text).join("\n") ?? "";
    expect(logText).toContain("メモが追加されました");
  });

  it("ONならデバウンス中はlistPendingAgentStartsに現れる", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ autoSuggestionUpdateAnalysisEnabled: true });
    const rt = await loadModule();
    rt.setSuggestionUpdateDebounceMsForTest(45_000);
    const suggestionStore = await import("./suggestion-store");
    const issue = await suggestionStore.createSuggestion("課題");

    rt.reactToSuggestionUpdate(issue.id, "charter", "Why");
    const pending = rt.listPendingAgentStarts();
    expect(pending).toHaveLength(1);
    expect(pending[0].suggestionId).toBe(issue.id);
    expect(pending[0].kind).toBe("suggestion-update");
    expect(pending[0].label).toContain("タイトル／整理");
    expect(pending[0].firesAt).toBeGreaterThan(Date.now());
    expect(rt.listRuns()).toHaveLength(0);

    // 再スケジュールでfiresAtが延びる（連打保存のデバウンス）
    const firstFiresAt = pending[0].firesAt;
    await new Promise((r) => setTimeout(r, 20));
    rt.reactToSuggestionUpdate(issue.id, "log", "経過を追記");
    const again = rt.listPendingAgentStarts();
    expect(again).toHaveLength(1);
    expect(again[0].firesAt).toBeGreaterThanOrEqual(firstFiresAt);
    expect(again[0].label).toContain("メモ");
  });
});

describe("selectRelatedSpecialists", () => {
  it("タグが無ければ全specialistを返す", async () => {
    const rt = await loadModule();
    const suggestionStore = await import("./suggestion-store");
    const issue = await suggestionStore.createSuggestion("課題");
    expect(rt.selectRelatedSpecialists(issue.id)).toEqual([
      "People Agent",
      "Process Agent",
      "Tech Agent",
      "Product Agent",
    ]);
  });

  it("介入型タグは保持されないため全specialistを返す", async () => {
    const rt = await loadModule();
    const suggestionStore = await import("./suggestion-store");
    const issue = await suggestionStore.createSuggestion("課題");
    expect(rt.selectRelatedSpecialists(issue.id)).toEqual([
      "People Agent",
      "Process Agent",
      "Tech Agent",
      "Product Agent",
    ]);
  });

  it("複数タグ指定も保持されないため全specialistを返す", async () => {
    const rt = await loadModule();
    const suggestionStore = await import("./suggestion-store");
    const issue = await suggestionStore.createSuggestion("課題");
    expect(rt.selectRelatedSpecialists(issue.id)).toEqual([
      "People Agent",
      "Process Agent",
      "Tech Agent",
      "Product Agent",
    ]);
  });
});

describe("チーム先行並列（runTeamParallelKickoff）", () => {
  it("Issue紐付きLead起動でspecialistを先行し、Leadが統合proposalを出す", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({
      teamParallelKickoffEnabled: true,
      maxParallelAgentRuns: 4,
    });
    const rt = await loadModule();
    const suggestionStore = await import("./suggestion-store");
    // タグは保持されないため全 quadrant specialist が先行する
    const issue = await suggestionStore.createSuggestion("課題");

    const leadRun = await rt.startRun("Lead Agent", "メンバーの1on1設計を見直したい", "manual", issue.id);

    await vi.waitFor(() => {
      if (rt.listRuns().length < 5) throw new Error("specialist runs not created yet");
    });
    const peopleRun = rt.listRuns().find((r) => r.agentName === "People Agent")!;
    const processRun = rt.listRuns().find((r) => r.agentName === "Process Agent")!;
    expect(peopleRun.consultedBy).toBe(leadRun.id);
    expect(processRun.consultedBy).toBe(leadRun.id);
    expect(rt.getRun(leadRun.id)?.log.some((l) => l.text.includes("[チーム先行並列]"))).toBe(true);

    // LeadはまだCLIを起動せず、specialist 4件が先にspawnされる（並列上限4）
    await waitForSpawnCount(4);
    expect(spawnCalls).toHaveLength(4);

    for (const call of spawnCalls.slice(0, 4)) {
      emitAssistantText(call.child, "先行回答");
      emitClaudeResult(call.child, { text: "先行回答" });
      closeChild(call.child, 0);
    }

    await waitForSpawnCount(5);
    const leadCall = spawnCalls[4];
    expect(leadCall.command).toBe("claude");
    const leadPrompt = leadCall.args[leadCall.args.indexOf("-p") + 1];
    expect(leadPrompt).toContain("先行回答");
    expect(leadPrompt).toContain("追加の専門エージェントへの相談はできません");

    emitClaudeResult(leadCall.child, {
      text: '```proposal\n{ "conclusion": "チーム見解を統合した結論", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(leadCall.child, 0);

    await vi.waitFor(() => {
      if (rt.getRun(leadRun.id)?.status === "active") throw new Error("still active");
    });
    expect(rt.getRun(leadRun.id)?.status).toBe("idle");
    expect(rt.getRun(leadRun.id)?.proposal?.conclusion).toBe("チーム見解を統合した結論");
    expect(spawnCalls).toHaveLength(5);
  });

  it("teamParallelKickoffEnabledがOFFならIssue紐付きでもLead単独起動", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ teamParallelKickoffEnabled: false });
    const rt = await loadModule();
    const suggestionStore = await import("./suggestion-store");
    const issue = await suggestionStore.createSuggestion("課題");

    await rt.startRun("Lead Agent", "単独で分析", "manual", issue.id);
    await waitForSpawnCount(1);
    expect(rt.listRuns()).toHaveLength(1);
    emitClaudeResult(spawnCalls[0].child, {
      text: '```proposal\n{ "conclusion": "ok", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(spawnCalls[0].child, 0);
  });

  it("Issue未紐付きのLeadは先行並列しない", async () => {
    const settingsStore = await import("./settings-store");
    settingsStore.updateRulesAndConstraints({ teamParallelKickoffEnabled: true });
    const rt = await loadModule();
    await rt.startRun("Lead Agent", "雑談相談");
    await waitForSpawnCount(1);
    expect(rt.listRuns()).toHaveLength(1);
    emitClaudeResult(spawnCalls[0].child, {
      text: '```proposal\n{ "conclusion": "ok", "facts": [], "logic": "l", "rejectedAlternatives": [] }\n```',
    });
    closeChild(spawnCalls[0].child, 0);
  });
});

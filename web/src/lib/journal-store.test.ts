import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

// journal-storeはローカルモデル（タグ抽出用・人物名NER用の2種類の呼び出し）、
// 埋め込み生成、Agent Runtime起動という3つの重い/副作用のある依存を持つため、
// すべてモックに差し替える。ローカルモデルは呼び出し元によってシステムプロンプトが
// 異なる（タグ抽出 vs NAME_EXTRACTION）ため、メッセージ内容で判定して応答を切り替える。
let mockExtraction: {
  tags: string[];
  people: string[];
  teams?: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
};
let mockNerPeople: string[];

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async (messages: { role: string; content: string }[]) => {
    const systemContent = messages[0]?.content ?? "";
    if (systemContent.includes("人物名だけ")) {
      return JSON.stringify({ people: mockNerPeople });
    }
    return JSON.stringify(mockExtraction);
  }),
  extractFirstJsonObject: vi.fn((text: string) => text),
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

const startRunMock = vi.fn(async (agentName: string, rawTask: string, origin?: string) => {
  void agentName;
  void rawTask;
  void origin;
  return {};
});
const startJournalAutoAnalysisMock = vi.fn(async (rawText: string, journalId?: string) => {
  void rawText;
  void journalId;
  return {};
});
const startJournalAnalysisMock = vi.fn(async (rawText: string, journalId?: string) => {
  void rawText;
  void journalId;
  return { id: "run-manual-analysis", agentName: "Lead Agent", sourceJournalId: journalId };
});
const listRunsMock = vi.fn(() => [] as Array<{ id: string; agentName: string; sourceJournalId?: string; updatedAt: number }>);
vi.mock("@/lib/agent-runtime", () => ({
  startRun: (...args: unknown[]) => startRunMock(...(args as [string, string, string?])),
  startJournalAutoAnalysis: (...args: unknown[]) => startJournalAutoAnalysisMock(...(args as [string, string?])),
  startJournalAnalysis: (...args: unknown[]) => startJournalAnalysisMock(...(args as [string, string?])),
  listRuns: () => listRunsMock(),
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
  mockNerPeople = [];
  startRunMock.mockClear();
  startJournalAutoAnalysisMock.mockClear();
  startJournalAnalysisMock.mockClear();
  listRunsMock.mockReset();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModule() {
  return import("@/lib/journal-store");
}

describe("addJournalEntry", () => {
  it("ローカルモデルの抽出結果でtags/people/urgency/sentiment/summaryを埋める（登録済み人物のみpeopleへ）", async () => {
    mockExtraction = { tags: ["1on1"], people: ["Aさん"], urgency: "low", sentiment: "positive", summary: "良い1on1だった" };
    const peopleDirectory = await import("@/lib/people-directory");
    peopleDirectory.registerName("Aさん");
    const store = await loadModule();
    const entry = await store.addJournalEntry("Aさんと1on1した。とても良かった");

    expect(entry.tags).toEqual(["1on1"]);
    expect(entry.urgency).toBe("low");
    expect(entry.sentiment).toBe("positive");
    expect(entry.confirmed).toBe(false); // 記録直後は未校正
    expect(entry.people).toEqual(["PERSON_1"]); // 内部表現はPERSON_n ID

    const view = store.toJournalEntryView(entry);
    expect(view.people).toEqual(["Aさん"]);
    expect(view.summary).toBe("良い1on1だった");
  });

  it("occurredAtを省略すると現在時刻になる", async () => {
    const store = await loadModule();
    const before = Date.now();
    const entry = await store.addJournalEntry("何か書いた");
    expect(entry.createdAt).toBeGreaterThanOrEqual(before);
  });

  it("occurredAtを指定すればその時刻で記録される", async () => {
    const store = await loadModule();
    const entry = await store.addJournalEntry("先日のこと", 12345);
    expect(entry.createdAt).toBe(12345);
  });

  it("抽出結果が不正な値の場合は安全な既定値にフォールバックする", async () => {
    mockExtraction = { tags: [], people: [], urgency: "invalid" as never, sentiment: "invalid" as never, summary: "" };
    const store = await loadModule();
    const entry = await store.addJournalEntry("テキスト");
    expect(entry.urgency).toBe("mid");
    expect(entry.sentiment).toBe("neutral");
  });

  it("ローカルモデルがJSONを返さなくても本文は未確認エントリとして保存される", async () => {
    const { extractFirstJsonObject } = await import("@/lib/local-model");
    vi.mocked(extractFirstJsonObject).mockReturnValueOnce(undefined);
    const store = await loadModule();
    const entry = await store.addJournalEntry("JSONにならないメモ");
    expect(entry.rawText).toBe("JSONにならないメモ");
    expect(entry.confirmed).toBe(false);
    expect(entry.tags).toEqual([]);
    expect(entry.urgency).toBe("mid");
    expect(entry.sentiment).toBe("neutral");
    expect(entry.summary).toBe("");
  });

  it("ローカルモデル呼び出しが失敗しても本文は保存される", async () => {
    const { runLocalChat } = await import("@/lib/local-model");
    vi.mocked(runLocalChat).mockRejectedValueOnce(new Error("model unavailable"));
    const store = await loadModule();
    const entry = await store.addJournalEntry("モデル落ちても残す");
    expect(entry.rawText).toBe("モデル落ちても残す");
    expect(entry.confirmed).toBe(false);
  });

  it("opts.peopleで明示した人物は抽出漏れでも紐付く", async () => {
    mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
    const peopleDirectory = await import("@/lib/people-directory");
    const personId = peopleDirectory.registerName("花子さん");
    const store = await loadModule();
    const entry = await store.addJournalEntry("進捗が遅れている", Date.now(), { people: ["花子さん"] });
    expect(entry.people).toEqual([personId]);
    expect(store.toJournalEntryView(entry).people).toEqual(["花子さん"]);
  });

  it("本文中の登録済みチーム名を自動でteamIdsに紐付ける", async () => {
    mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "negative", summary: "" };
    const org = await import("@/lib/org-context-store");
    const team = org.addTeam("基盤チーム", []);
    const store = await loadModule();
    const entry = await store.addJournalEntry("基盤チームの雰囲気が重い");
    expect(entry.teamIds).toEqual([team.id]);
    expect(store.toJournalEntryView(entry).teamNames).toEqual(["基盤チーム"]);
  });

  it("ローカル抽出のteams配列からも登録済みチームを紐付ける", async () => {
    mockExtraction = {
      tags: [],
      people: [],
      teams: ["基盤"],
      urgency: "mid",
      sentiment: "neutral",
      summary: "",
    };
    const org = await import("@/lib/org-context-store");
    const team = org.addTeam("Engineering / 基盤", []);
    await org.updateTeam(team.id, { aliases: ["基盤"] });
    const store = await loadModule();
    // 本文に正式名が無くても、抽出＋別名で解決できる
    const entry = await store.addJournalEntry("リリース後の振り返りをした");
    expect(entry.teamIds).toContain(team.id);
  });

  it("複数チームを同時に紐付けられる", async () => {
    mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
    const org = await import("@/lib/org-context-store");
    const a = org.addTeam("基盤チーム", []);
    const b = org.addTeam("プロダクトチーム", []);
    const store = await loadModule();
    const entry = await store.addJournalEntry("基盤チームとプロダクトチームの連携が悪い");
    expect(entry.teamIds.sort()).toEqual([a.id, b.id].sort());
  });

  it("updateJournalEntryでteamsを校正できる", async () => {
    mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
    const org = await import("@/lib/org-context-store");
    const team = org.addTeam("基盤チーム", []);
    const store = await loadModule();
    const entry = await store.addJournalEntry("メモ");
    expect(entry.teamIds).toEqual([]);
    const updated = await store.updateJournalEntry(entry.id, { teams: ["基盤チーム"] });
    expect(updated?.teamIds).toEqual([team.id]);
  });
});

describe("addJournalEntriesBulk", () => {
  it("1行ごとに独立したJournalエントリを作る", async () => {
    const store = await loadModule();
    const result = await store.addJournalEntriesBulk("Aさんと話した\nBさんと話した");
    expect(result.entries).toHaveLength(2);
    expect(result.skippedLines).toBe(0);
  });

  it("日付マーカー行はエントリ化されず、以降の行の日付を更新する", async () => {
    const store = await loadModule();
    const result = await store.addJournalEntriesBulk("2026-01-15\nAさんと話した");
    expect(result.entries).toHaveLength(1);
    const expected = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
    expect(result.entries[0].createdAt).toBe(expected);
  });

  it("空行のみのテキストは0件を返す", async () => {
    const store = await loadModule();
    const result = await store.addJournalEntriesBulk("\n\n  \n");
    expect(result.entries).toHaveLength(0);
    expect(result.skippedLines).toBe(0);
  });
});

describe("listJournalEntries", () => {
  it("記録した順にすべて一覧できる", async () => {
    const store = await loadModule();
    await store.addJournalEntry("1件目");
    await store.addJournalEntry("2件目");
    expect(store.listJournalEntries()).toHaveLength(2);
  });

  it("updateJournalEntryで置き換えられた旧バージョンは一覧から除外される", async () => {
    const store = await loadModule();
    const entry = await store.addJournalEntry("元のテキスト");
    await store.updateJournalEntry(entry.id, { rawText: "訂正後のテキスト" });
    const list = store.listJournalEntries();
    expect(list).toHaveLength(1);
    expect(list[0].rawText).toBe("訂正後のテキスト");
  });
});

describe("listJournalEntriesPage", () => {
  it("ページング・totalを返し、置き換えられた旧バージョンは除外する", async () => {
    const store = await loadModule();
    const e1 = await store.addJournalEntry("1件目", 1);
    await store.addJournalEntry("2件目", 2);
    await store.updateJournalEntry(e1.id, { rawText: "1件目（訂正）" });

    const { entries, total } = store.listJournalEntriesPage({}, { limit: 1, offset: 0 });
    expect(total).toBe(2);
    expect(entries).toHaveLength(1);
  });

  it("queryは実名のまま渡してもマスク後の保存内容と一致する", async () => {
    mockExtraction = { tags: [], people: ["Aさん"], urgency: "mid", sentiment: "neutral", summary: "" };
    const store = await loadModule();
    const created = await store.addJournalEntry("Aさんと1on1した");
    mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
    await store.addJournalEntry("無関係な話", 2);

    const { entries, total } = store.listJournalEntriesPage({ query: "Aさん" }, { limit: 10, offset: 0 });
    expect(total).toBe(1);
    expect(entries[0].id).toBe(created.id);
  });

  it("personは実名で渡すとPERSON_n IDへ変換して絞り込む", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    peopleDirectory.registerName("Aさん");
    peopleDirectory.registerName("Bさん");
    mockExtraction = { tags: [], people: ["Aさん"], urgency: "mid", sentiment: "neutral", summary: "" };
    const store = await loadModule();
    await store.addJournalEntry("Aさんと1on1した");
    mockExtraction = { tags: [], people: ["Bさん"], urgency: "mid", sentiment: "neutral", summary: "" };
    await store.addJournalEntry("Bさんと話した", 2);

    const { total } = store.listJournalEntriesPage({ person: "Aさん" }, { limit: 10, offset: 0 });
    expect(total).toBe(1);
  });

  it("未登録の人物名を渡した場合は該当なし（新規登録はしない）", async () => {
    const store = await loadModule();
    await store.addJournalEntry("何か書いた");
    const { total } = store.listJournalEntriesPage({ person: "未登録さん" }, { limit: 10, offset: 0 });
    expect(total).toBe(0);
  });
});

describe("findJournalEntryOffset", () => {
  it("同じフィルタでの位置（0-indexed）を返す", async () => {
    const store = await loadModule();
    await store.addJournalEntry("新しい方", 2);
    const older = await store.addJournalEntry("古い方", 1);
    expect(store.findJournalEntryOffset(older.id, {})).toBe(1);
  });

  it("journal以外のentityTypeや存在しないIDはundefinedを返す", async () => {
    const store = await loadModule();
    expect(store.findJournalEntryOffset("missing", {})).toBeUndefined();
  });
});

describe("listJournalFacets", () => {
  it("実名・実タグへ復元したタグ・人物の一覧を返す（置き換えられた旧版は除外）", async () => {
    mockExtraction = { tags: ["1on1"], people: ["Aさん"], urgency: "mid", sentiment: "neutral", summary: "" };
    const store = await loadModule();
    const entry = await store.addJournalEntry("Aさんと1on1した");
    mockExtraction = { tags: ["振り返り"], people: ["Bさん"], urgency: "mid", sentiment: "neutral", summary: "" };
    await store.updateJournalEntry(entry.id, { tags: ["振り返り"], people: ["Bさん"] });

    const facets = store.listJournalFacets();
    expect(facets.tags).toEqual(["振り返り"]);
    expect(facets.people).toEqual(["Bさん"]);
  });
});

describe("updateJournalEntry", () => {
  it("存在しないIDはundefinedを返す", async () => {
    const store = await loadModule();
    expect(await store.updateJournalEntry("missing", { tags: ["x"] })).toBeUndefined();
  });

  it("校正後はconfirmed:trueになる", async () => {
    const store = await loadModule();
    const entry = await store.addJournalEntry("元のテキスト");
    const updated = await store.updateJournalEntry(entry.id, { tags: ["確認済み"] });
    expect(updated?.confirmed).toBe(true);
  });

  it("resolvedIssueId未指定は既存値を保持し、nullは解除し、文字列は設定する", async () => {
    const store = await loadModule();
    const entry = await store.addJournalEntry("問題発生");

    const withResolution = await store.updateJournalEntry(entry.id, { resolvedIssueId: "issue-1" });
    expect(withResolution?.resolvedIssueId).toBe("issue-1");

    const untouched = await store.updateJournalEntry(withResolution!.id, { tags: ["x"] });
    expect(untouched?.resolvedIssueId).toBe("issue-1");

    const cleared = await store.updateJournalEntry(untouched!.id, { resolvedIssueId: null });
    expect(cleared?.resolvedIssueId).toBeUndefined();
  });

  it("urgency:highへの校正時、autoAnomalyDetectionEnabledがtrueならLead Agentを起動する", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ autoAnomalyDetectionEnabled: true });
    const store = await loadModule();
    const entry = await store.addJournalEntry("問題発生");
    const updated = await store.updateJournalEntry(entry.id, { urgency: "high" });
    expect(startJournalAutoAnalysisMock).toHaveBeenCalledTimes(1);
    expect(startJournalAutoAnalysisMock).toHaveBeenCalledWith("問題発生", updated!.id);
  });

  it("autoAnomalyDetectionEnabledが既定(false)ならLead Agentを起動しない", async () => {
    const store = await loadModule();
    const entry = await store.addJournalEntry("問題発生");
    await store.updateJournalEntry(entry.id, { urgency: "high" });
    expect(startJournalAutoAnalysisMock).not.toHaveBeenCalled();
  });

  it("2回目以降の校正では自動検知を再起動しない（supersedesが既にある場合）", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ autoAnomalyDetectionEnabled: true });
    const store = await loadModule();
    const entry = await store.addJournalEntry("問題発生");
    const first = await store.updateJournalEntry(entry.id, { urgency: "high" });
    startJournalAutoAnalysisMock.mockClear();
    await store.updateJournalEntry(first!.id, { tags: ["再校正"] });
    expect(startJournalAutoAnalysisMock).not.toHaveBeenCalled();
  });

  it("mid_or_higherフィルタならurgency:midでも起動する", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({
      autoAnomalyDetectionEnabled: true,
      autoJournalUrgencyFilter: "mid_or_higher",
    });
    mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
    const store = await loadModule();
    const entry = await store.addJournalEntry("気になる出来事");
    await store.updateJournalEntry(entry.id, { urgency: "mid" });
    expect(startJournalAutoAnalysisMock).toHaveBeenCalledTimes(1);
  });

  it("negative_onlyフィルタならpositiveでは起動しない", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({
      autoAnomalyDetectionEnabled: true,
      autoJournalUrgencyFilter: "all",
      autoJournalSentimentFilter: "negative_only",
    });
    mockExtraction = { tags: [], people: [], urgency: "high", sentiment: "positive", summary: "" };
    const store = await loadModule();
    const entry = await store.addJournalEntry("良い出来事");
    await store.updateJournalEntry(entry.id, { urgency: "high" });
    expect(startJournalAutoAnalysisMock).not.toHaveBeenCalled();
  });
});

describe("requestJournalAnalysis", () => {
  it("未確認エントリはエラーにする", async () => {
    const store = await loadModule();
    const entry = await store.addJournalEntry("問題発生");
    await expect(store.requestJournalAnalysis(entry.id)).rejects.toThrow(/未確認/);
    expect(startJournalAnalysisMock).not.toHaveBeenCalled();
  });

  it("確定済みならフィルタ／自動OFFに関係なく手動分析を起動する", async () => {
    const store = await loadModule();
    const entry = await store.addJournalEntry("問題発生");
    const confirmed = await store.updateJournalEntry(entry.id, { urgency: "low" });
    startJournalAutoAnalysisMock.mockClear();
    const result = await store.requestJournalAnalysis(confirmed!.id);
    expect(startJournalAnalysisMock).toHaveBeenCalledWith(
      "問題発生",
      confirmed!.id,
      expect.objectContaining({ trigger: "manual", onUnconfirmedNames: "throw" }),
    );
    expect(result?.run.id).toBe("run-manual-analysis");
    expect(startJournalAutoAnalysisMock).not.toHaveBeenCalled();
  });

  it("存在しないIDはundefinedを返す", async () => {
    const store = await loadModule();
    expect(await store.requestJournalAnalysis("missing")).toBeUndefined();
  });
});

describe("toJournalEntryView", () => {
  it("resolvedIssueIdが設定されている場合はIssueタイトルを解決する", async () => {
    const issueStore = await import("@/lib/issue-store");
    const store = await loadModule();
    const issue = await issueStore.createIssue("追跡中のIssue");
    const entry = await store.addJournalEntry("問題発生");
    const updated = await store.updateJournalEntry(entry.id, { resolvedIssueId: issue.id });
    const view = store.toJournalEntryView(updated!);
    expect(view.resolvedIssueTitle).toBe("追跡中のIssue");
  });

  it("sourceJournalIdが一致するLead相談をsourceConsultRunIdに載せる", async () => {
    const store = await loadModule();
    const entry = await store.addJournalEntry("問題発生");
    const confirmed = await store.updateJournalEntry(entry.id, { tags: ["確認済み"] });
    listRunsMock.mockReturnValue([
      { id: "run-consult", agentName: "Lead Agent", sourceJournalId: confirmed!.id, updatedAt: 10 },
    ]);
    expect(store.toJournalEntryView(confirmed!).sourceConsultRunId).toBe("run-consult");

    const edited = await store.updateJournalEntry(confirmed!.id, { tags: ["再校正"] });
    expect(store.toJournalEntryView(edited!).sourceConsultRunId).toBe("run-consult");
  });
});

describe("getCurrentJournalEntry / listSourceJournalsForIssue", () => {
  it("supersedesされた旧IDからも現行版を返す", async () => {
    const store = await loadModule();
    const original = await store.addJournalEntry("旧本文");
    const updated = await store.updateJournalEntry(original.id, { tags: ["確認済み"] });
    const current = store.getCurrentJournalEntry(original.id);
    expect(current?.id).toBe(updated!.id);
    expect(current?.rawText).toBe("旧本文");
  });

  it("resolvedIssueIdとsourceJournalIdの両方から重複なく集める", async () => {
    const issueStore = await import("@/lib/issue-store");
    const store = await loadModule();
    const issue = await issueStore.createIssue("追跡");
    const entry = await store.addJournalEntry("問題発生");
    const linked = await store.updateJournalEntry(entry.id, { resolvedIssueId: issue.id });
    const listed = store.listSourceJournalsForIssue(issue.id, entry.id);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(linked!.id);
  });

  it("linkJournalToIssueは現行版へresolvedIssueIdを付ける", async () => {
    const store = await loadModule();
    const original = await store.addJournalEntry("問題発生");
    const confirmed = await store.updateJournalEntry(original.id, { tags: ["確認済み"] });
    const linked = await store.linkJournalToIssue(original.id, "issue-9");
    expect(linked?.id).not.toBe(confirmed!.id);
    expect(linked?.resolvedIssueId).toBe("issue-9");
    expect(store.getCurrentJournalEntry(original.id)?.resolvedIssueId).toBe("issue-9");
  });
});

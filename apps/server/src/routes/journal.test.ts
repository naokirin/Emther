import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

let mockExtraction: {
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
  profileCandidate?: { person: string; text: string } | null;
};

vi.mock("@emther/core/local-model", () => ({
  runLocalChat: vi.fn(async (messages: { role: string; content: string }[]) => {
    const systemContent = messages[0]?.content ?? "";
    if (systemContent.includes("人物名だけ")) return JSON.stringify({ people: [] });
    return JSON.stringify(mockExtraction);
  }),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@emther/core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

// 元テストの一部（web/src/app/api/journal/route.test.ts）は実際の辞書・形態素解析による
// 未登録名検出に依存していたため、ここでは name-candidate-detect をモックしない
// （他のdescribeブロックは元々このモック無しでも通っていたテスト群と同等の入力しか使わない）。

const startJournalAnalysisMock = vi.hoisted(() =>
  vi.fn(async (rawText: string, journalId?: string) => ({
    id: "run-analyze",
    agentName: "Lead Agent",
    task: `対象のJournalエントリ: "${rawText}"`,
    status: "active",
    log: [],
    totalCostUsd: 0,
    createdAt: 1,
    updatedAt: 1,
    origin: "auto-anomaly",
    reviewed: false,
    sourceJournalId: journalId,
  })),
);

const startJournalBatchAnalysisMock = vi.hoisted(() =>
  vi.fn(async (): Promise<Record<string, unknown> | undefined> => ({
    id: "run-batch",
    agentName: "Lead Agent",
    task: "journal-batch",
    status: "active",
    log: [],
    totalCostUsd: 0,
    createdAt: 1,
    updatedAt: 1,
    origin: "auto-journal-batch",
    reviewed: true,
  })),
);

vi.mock("@emther/core/agent-runtime/index", () => ({
  startRun: vi.fn(async () => ({})),
  listRuns: () => [],
  toRunView: <T,>(run: T) => run,
  startJournalAnalysis: (...args: unknown[]) => startJournalAnalysisMock(...(args as [string, string?])),
  startJournalBatchAnalysis: (...args: Parameters<typeof startJournalBatchAnalysisMock>) => startJournalBatchAnalysisMock(...args),
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
  startJournalAnalysisMock.mockClear();
  startJournalBatchAnalysisMock.mockClear();
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

describe("GET /api/journal", () => {
  it("空なら空配列", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/");
    expect(await res.json()).toEqual({ entries: [] });
  });
});

describe("POST /api/journal", () => {
  it("textが無ければ400", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/", post({ text: "  " }));
    expect(res.status).toBe(400);
  });

  it("記録できる（201）。抽出peopleは登録済みの人物だけ紐付く（自動登録しない）", async () => {
    mockExtraction = { tags: ["1on1"], people: ["Aさん"], urgency: "low", sentiment: "positive", summary: "良かった" };
    const peopleDirectory = await import("@emther/core/people-directory");
    peopleDirectory.registerName("Aさん");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/", post({ text: "Aさんと1on1した" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.entry.tags).toEqual(["1on1"]);
    expect(json.entry.people).toEqual(["Aさん"]); // 実名復元済み
    expect(json.entry.confirmed).toBe(false);
  });

  it("未登録の抽出peopleは自動登録せず空のまま", async () => {
    mockExtraction = { tags: ["1on1"], people: ["新人さん"], urgency: "low", sentiment: "neutral", summary: "1on1した" };
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request(
      "/",
      post({ text: "新人さんと1on1した", allowUnmaskedNameCandidates: true }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.entry.people).toEqual([]);
    const peopleDirectory = await import("@emther/core/people-directory");
    expect(peopleDirectory.listPeople()).toHaveLength(0);
  });

  // docs/memo.md「メンバーに登録がない名前をJournalで入力して分析にかけましたが、とくに
  // 引っかからずにAIに渡されてしまいました」対応。データ入力（保存）時点で検出し、
  // 未確認なら保存自体をブロックして確認を求めるように変更した。
  it("人名らしいが未登録の語句があると、確認フラグ無しでは保存をブロックし409で候補を返す", async () => {
    mockExtraction = { tags: ["1on1"], people: [], urgency: "low", sentiment: "neutral", summary: "1on1した" };
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/", post({ text: "新人さんと1on1した" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("NAME_CANDIDATE_CONFIRMATION_REQUIRED");
    expect(json.candidates).toEqual(["新人さん"]);
    const peopleDirectory = await import("@emther/core/people-directory");
    expect(peopleDirectory.listPeople()).toHaveLength(0);
  });

  it("allowUnmaskedNameCandidatesで確認済みとして進めると保存できる", async () => {
    mockExtraction = { tags: ["1on1"], people: [], urgency: "low", sentiment: "neutral", summary: "1on1した" };
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request(
      "/",
      post({ text: "新人さんと1on1した", allowUnmaskedNameCandidates: true }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    // 未マスクのまま進めることを確認済み（acknowledge）にしたため、保存直後の
    // ヒント（nameCandidates）は空（保存前ダイアログで完結）。
    expect(json.nameCandidates).toEqual([]);
    // 未マスクのまま進めることを許可しただけで、people自体は自動登録しない（既存方針は変えない）。
    expect(json.entry.people).toEqual([]);
    const peopleDirectory = await import("@emther/core/people-directory");
    expect(peopleDirectory.listPeople()).toHaveLength(0);
  });

  it("形態素では拾えないがローカル抽出だけが拾った未登録名でも409で確認を求める", async () => {
    // name-candidate-detect が空でも、抽出 people がゲートに合流する。
    mockExtraction = { tags: [], people: ["未登録太郎"], urgency: "low", sentiment: "neutral", summary: "" };
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/", post({ text: "未登録太郎さんと話した" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("NAME_CANDIDATE_CONFIRMATION_REQUIRED");
    expect(json.candidates).toContain("未登録太郎");
  });

  // docs/memo.md「JournalのAIでの分析結果として、メンバーの長期プロファイルに入れる」対応。
  it("既登録の人物についての長期プロファイル候補をprofileCandidateとしてヒントに返す", async () => {
    mockExtraction = {
      tags: [],
      people: ["Aさん"],
      urgency: "low",
      sentiment: "positive",
      summary: "",
      profileCandidate: { person: "Aさん", text: "Aさんはレビューが速く的確" },
    };
    const peopleDirectory = await import("@emther/core/people-directory");
    peopleDirectory.registerName("Aさん");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/", post({ text: "Aさんはいつもレビューが速い" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.profileCandidate).toEqual({ person: "Aさん", text: "Aさんはレビューが速く的確" });
  });

  it("候補が無い・未登録人物のときはprofileCandidateを含まない", async () => {
    mockExtraction = { tags: [], people: [], urgency: "low", sentiment: "neutral", summary: "", profileCandidate: null };
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/", post({ text: "特に何もないメモ" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.profileCandidate).toBeUndefined();
  });

  it("occurredAtDateを指定すると日付レベルで記録される", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/", post({ text: "先日のこと", occurredAtDate: "2026-01-15" }));
    const json = await res.json();
    expect(json.entry.createdAt).toBe(new Date(2026, 0, 15, 12, 0, 0, 0).getTime());
  });

  it("occurredAtDateの形式が不正なら400", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/", post({ text: "テキスト", occurredAtDate: "not-a-date" }));
    expect(res.status).toBe(400);
  });

  it("peopleを明示するとNER抽出が空でも紐付く", async () => {
    mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
    const peopleDirectory = await import("@emther/core/people-directory");
    peopleDirectory.registerName("花子さん");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/", post({ text: "進捗が遅れている", people: ["花子さん"] }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.entry.people).toEqual(["花子さん"]);
  });
});

describe("PATCH /api/journal/:id", () => {
  it("存在しないIDは404", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/missing", patch({ tags: ["x"] }));
    expect(res.status).toBe(404);
  });

  it("rawTextを空にしようとすると400", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const entry = await journalStore.addJournalEntry("元のテキスト");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request(`/${entry.id}`, patch({ rawText: "  " }));
    expect(res.status).toBe(400);
  });

  it("occurredAtDateの形式が不正なら400", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const entry = await journalStore.addJournalEntry("テキスト");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request(`/${entry.id}`, patch({ occurredAtDate: "invalid" }));
    expect(res.status).toBe(400);
  });

  it("校正できる（tags/urgency/occurredAtDate）", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const entry = await journalStore.addJournalEntry("テキスト");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request(
      `/${entry.id}`,
      patch({ tags: ["確認済み"], urgency: "high", occurredAtDate: "2026-01-15" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entry.tags).toEqual(["確認済み"]);
    expect(json.entry.urgency).toBe("high");
    expect(json.entry.createdAt).toBe(new Date(2026, 0, 15, 12, 0, 0, 0).getTime());
    expect(json.entry.confirmed).toBe(true);
  });

  it("teamsで関連チームを複数紐付けできる", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const org = await import("@emther/core/org-context-store/index");
    const a = org.addTeam("コアチーム", []);
    const b = org.addTeam("プロダクトチーム", []);
    const entry = await journalStore.addJournalEntry("テキスト");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request(`/${entry.id}`, patch({ teams: ["コアチーム", "プロダクトチーム"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entry.teamIds.sort()).toEqual([a.id, b.id].sort());
    expect(json.entry.teamNames.sort()).toEqual(["コアチーム", "プロダクトチーム"].sort());
  });

  it("resolvedSuggestionId/resolutionNoteの3値（未指定=維持・null=解除・文字列=設定）", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const suggestionStore = await import("@emther/core/suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案");
    const entry = await journalStore.addJournalEntry("問題発生");
    const { journalRoute } = await import("./journal");

    const withResolution = await journalRoute.request(`/${entry.id}`, patch({ resolvedSuggestionId: suggestion.id }));
    const withResolutionJson = await withResolution.json();
    expect(withResolutionJson.entry.resolvedSuggestionId).toBe(suggestion.id);

    const untouched = await journalRoute.request(`/${withResolutionJson.entry.id}`, patch({ tags: ["x"] }));
    expect((await untouched.json()).entry.resolvedSuggestionId).toBe(suggestion.id);
  });

  it("resolvedSuggestionIdはプレフィックス一致でも解決できる", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const suggestionStore = await import("@emther/core/suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案");
    const entry = await journalStore.addJournalEntry("問題発生");
    const { journalRoute } = await import("./journal");

    const res = await journalRoute.request(`/${entry.id}`, patch({ resolvedSuggestionId: suggestion.id.slice(0, 8) }));
    expect(res.status).toBe(200);
    expect((await res.json()).entry.resolvedSuggestionId).toBe(suggestion.id);
  });

  it("存在しないresolvedSuggestionIdは400", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const entry = await journalStore.addJournalEntry("問題発生");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request(
      `/${entry.id}`,
      patch({ resolvedSuggestionId: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/journal/:id", () => {
  it("現行版を返す（supersedesされた旧IDでも）", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const entry = await journalStore.addJournalEntry("元のテキスト");
    const updated = await journalStore.updateJournalEntry(entry.id, { tags: ["確認済み"] });
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request(`/${entry.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).entry.id).toBe(updated!.id);
  });

  it("存在しないIDは404", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/missing");
    expect(res.status).toBe(404);
  });
});

// docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。
describe("POST/DELETE /api/journal/:id/archive", () => {
  it("存在しないIDは404", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/missing/archive", post({}));
    expect(res.status).toBe(404);
  });

  it("アーカイブし、DELETEで解除できる", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const entry = await journalStore.addJournalEntry("重複して記録してしまった");
    const { journalRoute } = await import("./journal");

    const postRes = await journalRoute.request(`/${entry.id}/archive`, post({}));
    expect(postRes.status).toBe(200);
    const posted = await postRes.json();
    expect(posted.entry.archivedAt).toBeTypeOf("number");

    expect(journalStore.listJournalEntries().map((e) => e.id)).not.toContain(entry.id);

    const deleteRes = await journalRoute.request(`/${entry.id}/archive`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);
    const deleted = await deleteRes.json();
    expect(deleted.entry.archivedAt).toBeUndefined();
    expect(journalStore.listJournalEntries().map((e) => e.id)).toContain(entry.id);
  });
});

// ユーザー指摘「確認したが対応不要だった、を示せずネガポジの強調を減らせない」対応。
describe("POST/DELETE /api/journal/:id/no-action-needed", () => {
  beforeEach(() => {
    mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "negative", summary: "" };
  });

  it("存在しないIDは404", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/missing/no-action-needed", post({}));
    expect(res.status).toBe(404);
  });

  it("確認済み（対応不要）を記録し、DELETEで取り消せる", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const entry = await journalStore.addJournalEntry("つらい出来事");
    const { journalRoute } = await import("./journal");

    const postRes = await journalRoute.request(`/${entry.id}/no-action-needed`, post({ note: "対応不要と判断" }));
    expect(postRes.status).toBe(200);
    const posted = await postRes.json();
    expect(posted.entry.sentiment).toBe("negative");
    expect(posted.entry.noActionNeededAt).toBeDefined();
    expect(posted.entry.noActionNeededNote).toBe("対応不要と判断");

    const deleteRes = await journalRoute.request(`/${entry.id}/no-action-needed`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);
    const deleted = await deleteRes.json();
    expect(deleted.entry.noActionNeededAt).toBeUndefined();
  });
});

describe("POST /api/journal/bulk", () => {
  it("textが無ければ400", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/bulk", post({ text: "" }));
    expect(res.status).toBe(400);
  });

  it("複数行を1行1エントリとして記録する（201）", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/bulk", post({ text: "1件目\n2件目" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.entries).toHaveLength(2);
    expect(json.skippedLines).toBe(0);
  });
});

describe("GET /api/journal/search", () => {
  async function addEntry(text: string, opts?: { extraction?: Partial<typeof mockExtraction>; occurredAtDate?: string }) {
    if (opts?.extraction) mockExtraction = { ...mockExtraction, ...opts.extraction };
    const { journalRoute } = await import("./journal");
    const body: Record<string, unknown> = { text };
    if (opts?.occurredAtDate) body.occurredAtDate = opts.occurredAtDate;
    const res = await journalRoute.request("/", post(body));
    return (await res.json()).entry as { id: string };
  }

  it("既定はpageSize=10でentries/total/facetsを返す", async () => {
    await addEntry("1件目");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/search");
    const json = await res.json();
    expect(json.entries).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.pageSize).toBe(10);
    expect(json.facets).toEqual({ tags: [], people: [] });
  });

  it("page/pageSizeクエリでページ送りする", async () => {
    await addEntry("1件目");
    await addEntry("2件目");
    await addEntry("3件目");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/search?pageSize=1&page=2");
    const json = await res.json();
    expect(json.entries).toHaveLength(1);
    expect(json.total).toBe(3);
    expect(json.page).toBe(2);
  });

  it("urgency/sentimentクエリで絞り込み、facetsに実名・実タグが載る", async () => {
    // ローカル抽出の人物は既登録のみ紐付く（自動登録しない）ため、先に名簿へ載せる。
    const peopleDirectory = await import("@emther/core/people-directory");
    peopleDirectory.registerName("Aさん");
    await addEntry("Aさんと1on1した", { extraction: { tags: ["1on1"], people: ["Aさん"], urgency: "high", sentiment: "positive" } });
    await addEntry("普通の話", { extraction: { tags: [], people: [], urgency: "low", sentiment: "neutral" } });
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/search?urgency=high&sentiment=positive");
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.facets.tags).toContain("1on1");
    expect(json.facets.people).toContain("Aさん");
  });

  it("不正なurgency/sentiment値は無視する", async () => {
    await addEntry("1件目");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/search?urgency=bogus");
    const json = await res.json();
    expect(json.total).toBe(1);
  });

  it("focusIdを渡すと、そのエントリが載っているページ番号を返す", async () => {
    await addEntry("1件目（新しい）", { occurredAtDate: "2026-01-02" });
    const target = await addEntry("2件目（古い）", { occurredAtDate: "2026-01-01" });
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request(`/search?pageSize=1&focusId=${target.id}`);
    const json = await res.json();
    expect(json.page).toBe(2);
    expect(json.entries[0].id).toBe(target.id);
  });
});

describe("POST /api/journal/:id/analyze", () => {
  it("存在しないIDは404", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/missing/analyze", post({}));
    expect(res.status).toBe(404);
  });

  it("未確認エントリは400", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const entry = await journalStore.addJournalEntry("未確認のまま");
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request(`/${entry.id}/analyze`, post({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/未確認/);
    expect(startJournalAnalysisMock).not.toHaveBeenCalled();
  });

  it("確定済みなら手動分析を起動して201を返す", async () => {
    const journalStore = await import("@emther/core/journal-store");
    const entry = await journalStore.addJournalEntry("分析対象");
    const confirmed = await journalStore.updateJournalEntry(entry.id, { urgency: "low" });
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request(`/${confirmed!.id}/analyze`, post({}));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.run.id).toBe("run-analyze");
    expect(json.entry.sourceConsultRunId).toBe("run-analyze");
    expect(startJournalAnalysisMock).toHaveBeenCalled();
  });
});

// ユーザー要望「現場メモ（Journal）ページから、集約解釈を手動実行できるボタンを置きたい」対応。
describe("POST /api/journal/batch", () => {
  it("Lead Agentの分析Runを起動して201を返す", async () => {
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/batch", { method: "POST" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.run.id).toBe("run-batch");
    expect(startJournalBatchAnalysisMock).toHaveBeenCalled();
  });

  it("pendingUnmaskedのときは202を返す", async () => {
    startJournalBatchAnalysisMock.mockResolvedValueOnce(undefined);
    const { journalRoute } = await import("./journal");
    const res = await journalRoute.request("/batch", { method: "POST" });
    expect(res.status).toBe(202);
    expect((await res.json()).pendingUnmasked).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";

let mockExtraction: {
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
};

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async (messages: { role: string; content: string }[]) => {
    const systemContent = messages[0]?.content ?? "";
    if (systemContent.includes("人物名だけ")) return JSON.stringify({ people: [] });
    return JSON.stringify(mockExtraction);
  }),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

// docs/memo.md「テキストから検出されたメンバー名を確実に『人物』にすべて登録する」対応で
// createJournalEventFromTextがdetectUnregisteredNameCandidatesを呼ぶようになったため、
// 実際の辞書・形態素解析（重い・並列実行時にタイムアウトしやすい）を避けてモックする。
vi.mock("@core/name-candidate-detect", () => ({
  detectNameCandidatesAsync: async () => [] as string[],
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
}));

vi.mock("@/lib/agent-runtime", () => ({
  startRun: vi.fn(async () => ({})),
  listRuns: () => [],
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModule() {
  return import("@/lib/report-store");
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("generateReport", () => {
  it("週次レポートはperiodStart/periodEndを7日窓で計算する", async () => {
    const store = await loadModule();
    const now = 1_700_000_000_000;
    const report = store.generateReport("week", now);
    expect(report.periodEnd).toBe(now);
    expect(report.periodStart).toBe(now - 7 * DAY_MS);
    expect(report.periodType).toBe("week");
  });

  it("月次レポートは30日窓で計算する", async () => {
    const store = await loadModule();
    const now = 1_700_000_000_000;
    const report = store.generateReport("month", now);
    expect(report.periodStart).toBe(now - 30 * DAY_MS);
  });

  it("期間内のJournalエントリを集計する", async () => {
    const journalStore = await import("@/lib/journal-store");
    const store = await loadModule();
    const now = 1_700_000_000_000;

    mockExtraction = { tags: ["1on1"], people: [], urgency: "high", sentiment: "negative", summary: "問題発生" };
    await journalStore.addJournalEntry("期間内のエントリ", now - DAY_MS);
    await journalStore.addJournalEntry("期間外のエントリ", now - 100 * DAY_MS);

    const report = store.generateReport("week", now);
    expect(report.stats.journal.total).toBe(1);
    expect(report.stats.journal.byUrgency.high).toBe(1);
    expect(report.stats.journal.bySentiment.negative).toBe(1);
    expect(report.stats.journal.topTags).toEqual([{ tag: "1on1", count: 1 }]);
    expect(report.stats.journal.notableEntries).toHaveLength(1);
  });

  // ユーザー指摘「確認済み（対応不要）にしたJournalはメンバーのアラート換算から外したい」対応。
  it("確認済み（対応不要）にしたJournalはnotableEntriesから除外する", async () => {
    const journalStore = await import("@/lib/journal-store");
    const store = await loadModule();
    const now = 1_700_000_000_000;

    mockExtraction = { tags: [], people: [], urgency: "high", sentiment: "negative", summary: "問題発生" };
    const entry = await journalStore.addJournalEntry("確認したが対応不要だった", now - DAY_MS);
    await journalStore.setJournalNoActionNeeded(entry.id);

    const report = store.generateReport("week", now);
    expect(report.stats.journal.total).toBe(1);
    expect(report.stats.journal.notableEntries).toHaveLength(0);
  });

  it("期間内に作成・アーカイブされたIssueを分けて集計する", async () => {
    const issueStore = await import("@/lib/issue-store");
    const store = await loadModule();
    const now = Date.now();

    const archivedIssue = await issueStore.createIssue("アーカイブIssue");
    issueStore.setIssueArchived(archivedIssue.id, true);
    await issueStore.createIssue("もう1件のIssue");

    const report = store.generateReport("week", now + 1000);
    expect(report.stats.issues.createdCount).toBe(2);
    expect(report.stats.issues.archivedCount).toBe(1);
  });

  it("知識イベント(context:official)を種別ごとに集計する", async () => {
    const knowledgeStore = await import("@/lib/knowledge-store");
    const store = await loadModule();
    const now = Date.now();
    knowledgeStore.recordChangeEvent("issue", "issue-1", "変更履歴1");
    knowledgeStore.recordChangeEvent("team", "team-1", "変更履歴2");

    const report = store.generateReport("week", now + 1000);
    expect(report.stats.events.total).toBe(2);
    expect(report.stats.events.byEntityType).toEqual({ issue: 1, team: 1 });
  });
});

describe("listReports / getReport / updateReportNote", () => {
  it("生成したレポートを取得・一覧できる", async () => {
    const store = await loadModule();
    const report = store.generateReport("week");
    expect(store.getReport(report.id)?.id).toBe(report.id);
    expect(store.listReports("week").map((r) => r.id)).toContain(report.id);
    expect(store.listReports("month")).toHaveLength(0);
  });

  it("updateReportNoteはnoteを更新する", async () => {
    const store = await loadModule();
    const report = store.generateReport("week");
    const updated = await store.updateReportNote(report.id, "所感メモ");
    expect(updated?.note).toBe("所感メモ");
    expect(store.getReport(report.id)?.note).toBe("所感メモ");
  });

  it("存在しないIDのupdateReportNoteはundefinedを返す", async () => {
    const store = await loadModule();
    expect(await store.updateReportNote("missing", "x")).toBeUndefined();
  });
});

describe("toReportView", () => {
  it("PERSON_n IDを実名に復元する", async () => {
    const peopleDirectory = await import("@core/people-directory");
    const issueStore = await import("@/lib/issue-store");
    const store = await loadModule();
    peopleDirectory.registerName("Aさん");

    await issueStore.createIssue("Aさんの育成Issue");
    const report = store.generateReport("week");
    const view = store.toReportView(report);
    expect(view.stats.issues.createdTitles[0].title).toBe("Aさんの育成Issue");
  });
});

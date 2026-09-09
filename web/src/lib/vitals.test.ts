import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

let mockExtraction: {
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
};

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async (messages: { role: string; content: string }[]) => {
    const systemContent = messages[0]?.content ?? "";
    if (systemContent.includes("人物名だけ")) return JSON.stringify({ people: [] });
    return JSON.stringify(mockExtraction);
  }),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

vi.mock("@/lib/agent-runtime", () => ({
  startRun: vi.fn(async () => ({})),
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

async function loadModules() {
  const vitals = await import("@/lib/vitals");
  const orgStore = await import("@/lib/org-context-store");
  const journalStore = await import("@/lib/journal-store");
  const issueStore = await import("@/lib/issue-store");
  return { vitals, orgStore, journalStore, issueStore };
}

describe("computeOrgVitals", () => {
  it("メンバー未登録のチームは評価不能(unknown)", async () => {
    const { vitals, orgStore } = await loadModules();
    orgStore.addTeam("Team A", []);
    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("unknown");
    expect(result.teams[0].label).toBe("評価不能");
  });

  it("直近ウィンドウの件数がminEntriesForJudgement未満なら評価不能", async () => {
    const { vitals, orgStore } = await loadModules();
    orgStore.addTeam("Team A", ["Aさん"]);
    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("unknown");
  });

  it("ネガティブなJournalが多いチームはbad(要注意)判定になる", async () => {
    const { vitals, orgStore, journalStore } = await loadModules();
    orgStore.addTeam("Team A", ["Aさん"]);
    mockExtraction = { tags: [], people: ["Aさん"], urgency: "mid", sentiment: "negative", summary: "" };
    await journalStore.addJournalEntry("Aさんが不満");
    await journalStore.addJournalEntry("Aさんがまた不満");

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("bad");
    expect(result.teams[0].label).toBe("要注意");
  });

  it("ポジティブなJournalが多いチームはgood(安定)判定になる", async () => {
    const { vitals, orgStore, journalStore } = await loadModules();
    orgStore.addTeam("Team A", ["Aさん"]);
    mockExtraction = { tags: [], people: ["Aさん"], urgency: "mid", sentiment: "positive", summary: "" };
    await journalStore.addJournalEntry("Aさんが好調");
    await journalStore.addJournalEntry("Aさんがまた好調");

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("good");
  });

  it("チーム・メンバーが登録されていなければ1on1カバレッジは評価不能", async () => {
    const { vitals } = await loadModules();
    const result = vitals.computeOrgVitals();
    expect(result.oneOnOneCoverage.status).toBe("unknown");
  });

  it("1on1タグ付きJournalで言及されたメンバーだけがカバレッジ対象になる", async () => {
    const { vitals, orgStore, journalStore } = await loadModules();
    orgStore.addTeam("Team A", ["Aさん", "Bさん"]);
    mockExtraction = { tags: ["1on1"], people: ["Aさん"], urgency: "mid", sentiment: "neutral", summary: "" };
    await journalStore.addJournalEntry("Aさんと1on1した");

    const result = vitals.computeOrgVitals();
    expect(result.oneOnOneCoverage.covered).toBe(1);
    expect(result.oneOnOneCoverage.total).toBe(2);
    expect(result.oneOnOneCoverage.uncoveredMembers).toEqual(["PERSON_2"]);
  });

  // ユーザー要望「部下(自分が管理するチームのメンバー)とそれ以外を分けたい」対応。
  it("自分が管理していないチーム(managedByEm:false)のメンバーは1on1カバレッジの対象外", async () => {
    const { vitals, orgStore } = await loadModules();
    const team = orgStore.addTeam("パートナーチーム", ["Cさん"]);
    await orgStore.updateTeam(team.id, { managedByEm: false });

    const result = vitals.computeOrgVitals();
    expect(result.oneOnOneCoverage.status).toBe("unknown");
    expect(result.oneOnOneCoverage.total).toBe(0);
  });

  it("TeamVitalはmanagedByEmをそのまま返す", async () => {
    const { vitals, orgStore } = await loadModules();
    const team = orgStore.addTeam("Team A", []);
    await orgStore.updateTeam(team.id, { managedByEm: false });

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].managedByEm).toBe(false);
  });

  // ユーザー指摘「バイタルがIssueの状況(停滞・ブロッカー)に対して問題無いように見える」対応。
  it("チームに紐づくブロッカーIssueが1件あれば、Journalが良好でもwarn以上に引き上げる", async () => {
    const { vitals, orgStore, journalStore, issueStore } = await loadModules();
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    mockExtraction = { tags: [], people: ["Aさん"], urgency: "mid", sentiment: "positive", summary: "" };
    await journalStore.addJournalEntry("Aさんが好調");
    await journalStore.addJournalEntry("Aさんがまた好調");
    const issue = await issueStore.createIssue("障害対応", undefined, undefined, undefined, undefined, undefined, team.id);
    issueStore.setIssueStatus(issue.id, "blocked");

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("warn");
    expect(result.teams[0].reason).toContain("ブロッカー");
  });

  it("チームに紐づくブロッカーIssueがあっても、既にbad判定なら据え置く", async () => {
    const { vitals, orgStore, journalStore, issueStore } = await loadModules();
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    mockExtraction = { tags: [], people: ["Aさん"], urgency: "mid", sentiment: "negative", summary: "" };
    await journalStore.addJournalEntry("Aさんが不満");
    await journalStore.addJournalEntry("Aさんがまた不満");
    const issue = await issueStore.createIssue("障害対応", undefined, undefined, undefined, undefined, undefined, team.id);
    issueStore.setIssueStatus(issue.id, "blocked");

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("bad");
  });

  it("アーカイブ済みのブロッカーIssueは無視する", async () => {
    const { vitals, orgStore, issueStore } = await loadModules();
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    const issue = await issueStore.createIssue("障害対応", undefined, undefined, undefined, undefined, undefined, team.id);
    issueStore.setIssueStatus(issue.id, "blocked");
    issueStore.setIssueArchived(issue.id, true);

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("unknown");
  });
});

describe("computeIssueImpact", () => {
  it("チームに紐づいていないIssueはundefinedを返す", async () => {
    const { vitals, issueStore } = await loadModules();
    const issue = await issueStore.createIssue("チーム未紐付けIssue");
    expect(vitals.computeIssueImpact(issue)).toBeUndefined();
  });

  it("チームにメンバーが居ない場合もundefinedを返す", async () => {
    const { vitals, issueStore, orgStore } = await loadModules();
    const team = orgStore.addTeam("Team A", []);
    const issue = await issueStore.createIssue("Issue", undefined, undefined, undefined, undefined, undefined, team.id);
    expect(vitals.computeIssueImpact(issue)).toBeUndefined();
  });

  it("未完了のIssueはinProgress:trueで、Issue作成〜現在を観測窓にする", async () => {
    const { vitals, issueStore, orgStore, journalStore } = await loadModules();
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    const issue = await issueStore.createIssue("介入Issue", undefined, undefined, undefined, undefined, undefined, team.id);

    mockExtraction = { tags: [], people: ["Aさん"], urgency: "mid", sentiment: "positive", summary: "" };
    await journalStore.addJournalEntry("介入後の様子");

    const impact = vitals.computeIssueImpact(issue);
    expect(impact?.inProgress).toBe(true);
    expect(impact?.after.total).toBe(1);
  });

  it("アーカイブだけでは完了扱いの効果窓に入らない（inProgressのまま）", async () => {
    const { vitals, issueStore, orgStore, journalStore } = await loadModules();
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    const issue = await issueStore.createIssue("介入Issue", undefined, undefined, undefined, undefined, undefined, team.id);
    issueStore.setIssueArchived(issue.id, true);

    mockExtraction = { tags: [], people: ["Aさん"], urgency: "mid", sentiment: "positive", summary: "" };
    await journalStore.addJournalEntry("介入後の様子");

    const archivedIssue = issueStore.getIssue(issue.id)!;
    expect(archivedIssue.status).not.toBe("done");
    const impact = vitals.computeIssueImpact(archivedIssue);
    expect(impact?.inProgress).toBe(true);
  });

  it("status=doneのIssueはinProgress:falseで、doneAt以降windowDays日間を観測窓にする", async () => {
    const { vitals, issueStore, orgStore, journalStore } = await loadModules();
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    const issue = await issueStore.createIssue("介入Issue", undefined, undefined, undefined, undefined, undefined, team.id);
    issueStore.setIssueStatus(issue.id, "done");

    mockExtraction = { tags: [], people: ["Aさん"], urgency: "mid", sentiment: "positive", summary: "" };
    await journalStore.addJournalEntry("介入後の様子");

    const doneIssue = issueStore.getIssue(issue.id)!;
    const impact = vitals.computeIssueImpact(doneIssue);
    expect(impact?.inProgress).toBe(false);
    expect(impact?.after.total).toBe(1);
  });
});

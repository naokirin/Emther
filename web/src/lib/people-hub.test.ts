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

async function loadModule() {
  return import("@/lib/people-hub");
}

describe("listPersonSummaries", () => {
  it("登録済みの人物ごとにチーム所属・trend・factCountを集計する", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const orgStore = await import("@/lib/org-context-store");
    const journalStore = await import("@/lib/journal-store");
    const hub = await loadModule();

    const aId = peopleDirectory.registerName("Aさん");
    orgStore.addTeam("Team A", ["Aさん"]);

    mockExtraction = { tags: [], people: ["Aさん"], urgency: "mid", sentiment: "positive", summary: "" };
    await journalStore.addJournalEntry("Aさんと1on1した");
    mockExtraction.sentiment = "negative";
    await journalStore.addJournalEntry("Aさんが不満を漏らした");

    const summaries = hub.listPersonSummaries();
    const summary = summaries.find((s) => s.id === aId);
    expect(summary?.name).toBe("Aさん");
    expect(summary?.teamNames).toEqual(["Team A"]);
    expect(summary?.trend).toEqual({ positive: 1, negative: 1, neutral: 0 });
    expect(summary?.factCount).toBe(2);
  });

  it("誰も登録されていなければ空配列", async () => {
    const hub = await loadModule();
    expect(hub.listPersonSummaries()).toEqual([]);
  });

  // ユーザー要望「部下(自分が管理するチームのメンバー)とそれ以外を分けたい」対応。
  it("自分が管理するチーム(managedByEm:true)のメンバーはisDirectReport:true", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const hub = await loadModule();
    orgStore.addTeam("Team A", ["Aさん"]);

    const summary = hub.listPersonSummaries().find((s) => s.name === "Aさん");
    expect(summary?.isDirectReport).toBe(true);
  });

  it("自分が管理していないチーム(managedByEm:false)のみのメンバーはisDirectReport:false", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const hub = await loadModule();
    const team = orgStore.addTeam("パートナーチーム", ["Cさん"]);
    await orgStore.updateTeam(team.id, { managedByEm: false });

    const summary = hub.listPersonSummaries().find((s) => s.name === "Cさん");
    expect(summary?.isDirectReport).toBe(false);
  });

  it("兼務(管理チーム＋非管理チーム)ならisDirectReport:true", async () => {
    const orgStore = await import("@/lib/org-context-store");
    const hub = await loadModule();
    orgStore.addTeam("Team A", ["Dさん"]);
    const partner = orgStore.addTeam("パートナーチーム", ["Dさん"]);
    await orgStore.updateTeam(partner.id, { managedByEm: false });

    const summary = hub.listPersonSummaries().find((s) => s.name === "Dさん");
    expect(summary?.isDirectReport).toBe(true);
  });

  // ユーザー指摘「バイタルがIssueの状況(停滞・ブロッカー)に対して問題無いように見える」対応。
  it("関連Issueにブロッカーありのものが1件でもあればhasConcerningIssue:true", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const issueStore = await import("@/lib/issue-store");
    const hub = await loadModule();
    peopleDirectory.registerName("Aさん");
    const issue = await issueStore.createIssue("Aさんの育成計画");
    issueStore.setIssueStatus(issue.id, "blocked");

    const summary = hub.listPersonSummaries().find((s) => s.name === "Aさん");
    expect(summary?.hasConcerningIssue).toBe(true);
  });

  it("関連Issueがブロッカー・停滞のいずれでもなければhasConcerningIssue:false", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const issueStore = await import("@/lib/issue-store");
    const hub = await loadModule();
    peopleDirectory.registerName("Aさん");
    await issueStore.createIssue("Aさんの育成計画");

    const summary = hub.listPersonSummaries().find((s) => s.name === "Aさん");
    expect(summary?.hasConcerningIssue).toBe(false);
  });

  it("アーカイブ済みのブロッカーIssueは無視する", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const issueStore = await import("@/lib/issue-store");
    const hub = await loadModule();
    peopleDirectory.registerName("Aさん");
    const issue = await issueStore.createIssue("Aさんの育成計画");
    issueStore.setIssueStatus(issue.id, "blocked");
    issueStore.setIssueArchived(issue.id, true);

    const summary = hub.listPersonSummaries().find((s) => s.name === "Aさん");
    expect(summary?.hasConcerningIssue).toBe(false);
  });
});

describe("getPersonProfile", () => {
  it("IDと実名のどちらでも検索できる", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const hub = await loadModule();
    const id = peopleDirectory.registerName("Aさん");
    expect(hub.getPersonProfile(id)?.name).toBe("Aさん");
    expect(hub.getPersonProfile("Aさん")?.id).toBe(id);
  });

  it("未登録の人物はundefinedを返す", async () => {
    const hub = await loadModule();
    expect(hub.getPersonProfile("知らない人")).toBeUndefined();
  });

  it("関連Issueをタイトル・charterの部分一致で抽出する", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const issueStore = await import("@/lib/issue-store");
    const hub = await loadModule();
    peopleDirectory.registerName("Aさん");
    await issueStore.createIssue("Aさんの育成計画");
    await issueStore.createIssue("無関係のIssue");

    const profile = hub.getPersonProfile("Aさん");
    expect(profile?.relatedIssues).toHaveLength(1);
    expect(profile?.relatedIssues[0].title).toBe("Aさんの育成計画");
  });

  it("isDirectReport/hasConcerningIssueもlistPersonSummariesと同じ基準で返す", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const orgStore = await import("@/lib/org-context-store");
    const issueStore = await import("@/lib/issue-store");
    const hub = await loadModule();
    peopleDirectory.registerName("Aさん");
    orgStore.addTeam("Team A", ["Aさん"]);
    const issue = await issueStore.createIssue("Aさんの育成計画");
    issueStore.setIssueStatus(issue.id, "blocked");

    const profile = hub.getPersonProfile("Aさん");
    expect(profile?.isDirectReport).toBe(true);
    expect(profile?.hasConcerningIssue).toBe(true);
  });

  it("factsとinterpretationsを分けて返す", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const knowledgeStore = await import("@/lib/knowledge-store");
    const hub = await loadModule();
    const id = peopleDirectory.registerName("Aさん");
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [id], text: "fact-1", tags: [], occurredAt: 1 });
    knowledgeStore.recordEvent({ kind: "interpretation", context: "profile", entityType: "person", people: [id], text: "interpretation-1", tags: [], occurredAt: 2 });

    const profile = hub.getPersonProfile(id);
    expect(profile?.facts.map((f) => f.text)).toEqual(["fact-1"]);
    expect(profile?.interpretations.map((i) => i.text)).toEqual(["interpretation-1"]);
  });
});

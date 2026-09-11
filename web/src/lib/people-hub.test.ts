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

  // ユーザー要望「メンバーに自分自身を追加したいが区別できない」対応。
  it("selfPersonIdに紐付いた人物はisSelf:trueで部下扱いにしない", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const orgStore = await import("@/lib/org-context-store");
    const settings = await import("@/lib/settings-store");
    const hub = await loadModule();
    const selfId = peopleDirectory.registerName("EM本人");
    orgStore.addTeam("Team A", ["EM本人", "Aさん"]);
    settings.setSelfPersonId(selfId);

    const self = hub.listPersonSummaries().find((s) => s.id === selfId);
    const other = hub.listPersonSummaries().find((s) => s.name === "Aさん");
    expect(self?.isSelf).toBe(true);
    expect(self?.isDirectReport).toBe(false);
    expect(other?.isSelf).toBe(false);
    expect(other?.isDirectReport).toBe(true);
  });

  // ユーザー指摘「バイタルがIssueの状況に対して問題無いように見える」対応。
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

// ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。
describe("addPersonAlias / removePersonAlias", () => {
  it("別名を追加・取り消しでき、listPersonSummariesに反映される", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const hub = await loadModule();
    const id = peopleDirectory.registerName("田中さん");

    expect(hub.addPersonAlias(id, "田中")).toEqual({ ok: true });
    expect(hub.listPersonSummaries().find((s) => s.id === id)?.aliases).toEqual(["田中"]);

    expect(hub.removePersonAlias(id, "田中")).toBe(true);
    expect(hub.listPersonSummaries().find((s) => s.id === id)?.aliases).toEqual([]);
  });
});

// ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
describe("mergePersons", () => {
  it("Journal・チーム所属を統合先へ付け替え、統合元は一覧から消える", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const orgStore = await import("@/lib/org-context-store");
    const knowledgeStore = await import("@/lib/knowledge-store");
    const hub = await loadModule();

    const fromId = peopleDirectory.registerName("たなかさん");
    const toId = peopleDirectory.registerName("田中さん");
    orgStore.addTeam("Team A", ["たなかさん"]);
    knowledgeStore.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [fromId],
      text: `${fromId}と話した`,
      tags: [],
      occurredAt: 1,
    });

    const result = hub.mergePersons(fromId, toId);
    expect(result).toEqual({ ok: true });

    const summaries = hub.listPersonSummaries();
    expect(summaries.find((s) => s.id === fromId)).toBeUndefined();
    const merged = summaries.find((s) => s.id === toId)!;
    expect(merged.aliases).toEqual(["たなかさん"]);
    expect(merged.teamNames).toEqual(["Team A"]);
    expect(merged.factCount).toBe(1);
  });

  it("統合元が利用者本人ならselfPersonIdを統合先へ付け替える", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const settings = await import("@/lib/settings-store");
    const hub = await loadModule();
    const fromId = peopleDirectory.registerName("旧EM");
    const toId = peopleDirectory.registerName("EM");
    settings.setSelfPersonId(fromId);

    expect(hub.mergePersons(fromId, toId)).toEqual({ ok: true });
    expect(settings.getSelfPersonId()).toBe(toId);
    expect(hub.getPersonProfile(toId)?.isSelf).toBe(true);
  });

  it("people-directory側が失敗（存在しないID等）した場合はknowledge-store/teamsを更新しない", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const orgStore = await import("@/lib/org-context-store");
    const hub = await loadModule();
    const toId = peopleDirectory.registerName("田中さん");
    orgStore.addTeam("Team A", []);

    const result = hub.mergePersons("PERSON_999", toId);
    expect(result).toEqual({ ok: false, error: "統合元の人物が見つかりません" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/embeddings", () => ({
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

async function loadModules() {
  const timeline = await import("@/lib/timeline");
  const issueStore = await import("@/lib/issue-store");
  const orgStore = await import("@/lib/org-context-store");
  const knowledgeStore = await import("@/lib/knowledge-store");
  return { timeline, issueStore, orgStore, knowledgeStore };
}

describe("listTimelineEntries", () => {
  it("Issue作成イベントを、現在のIssueタイトルとリンク付きで返す", async () => {
    const { timeline, issueStore } = await loadModules();
    const issue = await issueStore.createIssue("障害対応");
    const entries = timeline.listTimelineEntries();
    const entry = entries.find((e) => e.entityId === issue.id);
    expect(entry?.entityType).toBe("issue");
    expect(entry?.entityLabel).toBe("障害対応");
    expect(entry?.href).toBe(`/issues/${issue.id}`);
  });

  it("Issueの後続の変更（タイトル変更）でも常に現在のタイトルを解決する", async () => {
    const { timeline, issueStore } = await loadModules();
    const issue = await issueStore.createIssue("旧タイトル");
    await issueStore.setIssueTitle(issue.id, "新タイトル");
    const entries = timeline.listTimelineEntries();
    // 起票イベントのentityLabelも、削除されていない限り現在のタイトルに解決される
    const createdEntry = entries.find((e) => e.text.includes("Issueを起票"));
    expect(createdEntry?.entityLabel).toBe("新タイトル");
  });

  it("Teamの変更イベントは/orgへのリンクになる", async () => {
    const { timeline, orgStore } = await loadModules();
    const team = orgStore.addTeam("Team A", []);
    const entries = timeline.listTimelineEntries();
    const entry = entries.find((e) => e.entityId === team.id);
    expect(entry?.entityType).toBe("team");
    expect(entry?.href).toBe("/org");
    expect(entry?.entityLabel).toBe("Team A");
  });

  it("Objectiveの変更イベントは/orgへのリンクになる", async () => {
    const { timeline, orgStore } = await loadModules();
    const objective = await orgStore.addObjective("売上を伸ばす");
    const entries = timeline.listTimelineEntries();
    const entry = entries.find((e) => e.entityId === objective.id);
    expect(entry?.entityType).toBe("org");
    expect(entry?.href).toBe("/org");
    expect(entry?.entityLabel).toBe("売上を伸ばす");
  });

  it("参照先エンティティが削除済みの場合はentityLabel/hrefを付けない", async () => {
    const { timeline, issueStore, knowledgeStore } = await loadModules();
    const issue = await issueStore.createIssue("後で消えるIssue");
    // issue-storeには削除APIが無いため、直接knowledge-storeへ「削除済みID」を指す
    // 変更イベントを記録することで、参照先が存在しないケースを再現する。
    knowledgeStore.recordChangeEvent("issue", "deleted-issue-id", "削除済みIssueへの変更履歴");
    const entries = timeline.listTimelineEntries();
    const entry = entries.find((e) => e.text === "削除済みIssueへの変更履歴");
    expect(entry?.entityLabel).toBeUndefined();
    expect(entry?.href).toBeUndefined();
    expect(issue.id).not.toBe("deleted-issue-id");
  });

  it("Journal(context:observation)のイベントは含まれない", async () => {
    const { timeline, knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "journal entry", tags: [], occurredAt: 1 });
    const entries = timeline.listTimelineEntries();
    expect(entries.find((e) => e.text === "journal entry")).toBeUndefined();
  });

  it("limitで件数を制限する", async () => {
    const { timeline, issueStore } = await loadModules();
    for (let i = 0; i < 5; i++) await issueStore.createIssue(`Issue ${i}`);
    expect(timeline.listTimelineEntries(2)).toHaveLength(2);
  });
});

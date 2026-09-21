import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "./test-helpers/store-env";

vi.mock("./local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("./embeddings", () => ({
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
  const timeline = await import("./timeline");
  const suggestionStore = await import("./suggestion-store");
  const orgStore = await import("./org-context-store/index");
  const knowledgeStore = await import("./knowledge-store");
  return { timeline, suggestionStore, orgStore, knowledgeStore };
}

describe("listTimelineEntries", () => {
  it("提案作成イベントを、現在のタイトルとリンク付きで返す", async () => {
    const { timeline, suggestionStore } = await loadModules();
    const suggestion = await suggestionStore.createSuggestion("障害対応");
    const entries = timeline.listTimelineEntries();
    const entry = entries.find((e) => e.entityId === suggestion.id);
    expect(entry?.entityType).toBe("suggestion");
    expect(entry?.entityLabel).toBe("障害対応");
    expect(entry?.href).toBe(`/suggestions/${suggestion.id}`);
  });

  it("提案の後続の変更（タイトル変更）でも常に現在のタイトルを解決する", async () => {
    const { timeline, suggestionStore } = await loadModules();
    const suggestion = await suggestionStore.createSuggestion("旧タイトル");
    await suggestionStore.setSuggestionTitle(suggestion.id, "新タイトル");
    const entries = timeline.listTimelineEntries();
    const createdEntry = entries.find((e) => e.text.includes("提案を作成") || e.text.includes("タイトルを変更"));
    expect(createdEntry?.entityLabel).toBe("新タイトル");
  });

  it("Teamの変更イベントは/teams?focus= へのリンクになる", async () => {
    const { timeline, orgStore } = await loadModules();
    const team = orgStore.addTeam("Team A", []);
    const entries = timeline.listTimelineEntries();
    const entry = entries.find((e) => e.entityId === team.id);
    expect(entry?.entityType).toBe("team");
    expect(entry?.href).toBe(`/teams?focus=${encodeURIComponent(team.id)}`);
    expect(entry?.entityLabel).toBe("Team A");
  });

  it("Goalの変更イベントは/orgへのリンクになる", async () => {
    const { timeline, orgStore } = await loadModules();
    const goal = await orgStore.addGoal({ title: "売上を伸ばす" });
    const entries = timeline.listTimelineEntries();
    const entry = entries.find((e) => e.entityId === goal.id);
    expect(entry?.entityType).toBe("org");
    expect(entry?.href).toBe("/org");
    expect(entry?.entityLabel).toBe("売上を伸ばす");
  });

  it("参照先エンティティが削除済みの場合はentityLabel/hrefを付けない", async () => {
    const { timeline, suggestionStore, knowledgeStore } = await loadModules();
    const suggestion = await suggestionStore.createSuggestion("後で消える提案");
    // suggestion-storeには削除APIが無いため、直接knowledge-storeへ「削除済みID」を指す
    // 変更イベントを記録することで、参照先が存在しないケースを再現する。
    knowledgeStore.recordChangeEvent("suggestion", "deleted-suggestion-id", "削除済み提案への変更履歴");
    const entries = timeline.listTimelineEntries();
    const entry = entries.find((e) => e.text === "削除済み提案への変更履歴");
    expect(entry?.entityLabel).toBeUndefined();
    expect(entry?.href).toBeUndefined();
    expect(suggestion.id).not.toBe("deleted-suggestion-id");
  });

  it("Journal(context:observation)のイベントは含まれない", async () => {
    const { timeline, knowledgeStore } = await loadModules();
    knowledgeStore.recordEvent({ kind: "fact", context: "observation", entityType: "journal", people: [], text: "journal entry", tags: [], occurredAt: 1 });
    const entries = timeline.listTimelineEntries();
    expect(entries.find((e) => e.text === "journal entry")).toBeUndefined();
  });

  it("limitで件数を制限する", async () => {
    const { timeline, suggestionStore } = await loadModules();
    for (let i = 0; i < 5; i++) await suggestionStore.createSuggestion(`提案 ${i}`);
    expect(timeline.listTimelineEntries(2)).toHaveLength(2);
  });
});

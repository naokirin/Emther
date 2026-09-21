import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "./test-helpers/store-env";

vi.mock("./local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

const embedRef = vi.hoisted(() => ({
  impl: async (_text: string): Promise<number[]> => {
    void _text;
    return [1, 0, 0];
  },
}));

vi.mock("./embeddings", () => ({
  embedText: (text: string) => embedRef.impl(text),
  cosineSimilarity: (a: number[], b: number[]) => {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  },
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  embedRef.impl = async () => [1, 0, 0];
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("agent-knowledge-tools", () => {
  it("extractLookupはqueriesをパースし上限で切る", async () => {
    const { extractLookup, LOOKUP_MAX_QUERIES } = await import("./agent-knowledge-tools");
    const queries = Array.from({ length: LOOKUP_MAX_QUERIES + 2 }, (_, i) => ({
      type: "suggestions",
      query: `q${i}`,
    }));
    const req = extractLookup(`\`\`\`lookup\n${JSON.stringify({ reason: "確認", queries })}\n\`\`\``);
    expect(req?.reason).toBe("確認");
    expect(req?.queries).toHaveLength(LOOKUP_MAX_QUERIES);
    expect(req?.queries.every((q) => q.type === "suggestions")).toBe(true);
  });

  it("extractLookupは不正・空でundefined", async () => {
    const { extractLookup } = await import("./agent-knowledge-tools");
    expect(extractLookup("no block")).toBeUndefined();
    expect(extractLookup('```lookup\n{ "queries": [] }\n```')).toBeUndefined();
    expect(extractLookup('```lookup\n{ "queries": [{ "type": "suggestions" }] }\n```')).toBeUndefined();
  });

  it("executeLookupのsuggestionsはキーワード一致と不在を返す", async () => {
    const suggestionStore = await import("./suggestion-store");
    const s1 = await suggestionStore.createSuggestion("Copilot Workspace 導入");
    await suggestionStore.addMemo(s1.id, "開発体験");
    await suggestionStore.createSuggestion("別件オンボーディング");

    const { executeLookup } = await import("./agent-knowledge-tools");
    const hit = await executeLookup({
      queries: [{ type: "suggestions", query: "Copilot Workspace", limit: 10 }],
    });
    expect(hit).toContain("Copilot Workspace 導入");
    expect(hit).toContain("ヒット=1");

    const miss = await executeLookup({
      queries: [{ type: "suggestions", query: "存在しないキーワードXYZ", limit: 10 }],
    });
    expect(miss).toContain("一致する提案はありません");
    expect(miss).toContain("ヒット=0");
  });

  it("executeLookupのsuggestionsはincludeDoneで完了済みも拾う", async () => {
    const suggestionStore = await import("./suggestion-store");
    const done = await suggestionStore.createSuggestion("完了したCopilot課題");
    await suggestionStore.setReviewStatus(done.id, "done");

    const { executeLookup } = await import("./agent-knowledge-tools");
    const withoutDone = await executeLookup({
      queries: [{ type: "suggestions", query: "Copilot", includeDone: false }],
    });
    expect(withoutDone).toContain("ヒット=0");

    const withDone = await executeLookup({
      queries: [{ type: "suggestions", query: "Copilot", includeDone: true }],
    });
    expect(withDone).toContain("完了したCopilot課題");
    expect(withDone).toContain("ヒット=1");
  });

  it("executeLookupのsuggestionはID詳細を返す", async () => {
    const suggestionStore = await import("./suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("詳細確認用");
    await suggestionStore.addMemo(suggestion.id, "理由本文");
    await suggestionStore.addMemo(suggestion.id, "何をやるか");
    const { executeLookup } = await import("./agent-knowledge-tools");
    const text = await executeLookup({ queries: [{ type: "suggestion", id: suggestion.id }] });
    expect(text).toContain(suggestion.id);
    expect(text).toContain("詳細確認用");
    expect(text).toContain("何をやるか");

    const missing = await executeLookup({ queries: [{ type: "suggestion", id: "no-such-id" }] });
    expect(missing).toContain("見つかりませんでした");
  });

  it("executeLookupのjournalsはキーワード検索する", async () => {
    const knowledge = await import("./knowledge-store");
    knowledge.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "今日の1on1でCopilotの話が出た",
      tags: [],
      occurredAt: Date.now(),
    });

    const { executeLookup } = await import("./agent-knowledge-tools");
    const hit = await executeLookup({
      queries: [{ type: "journals", query: "Copilot", limit: 5 }],
    });
    expect(hit).toContain("Copilot");
    expect(hit).toMatch(/ヒット=[1-9]/);

    const miss = await executeLookup({
      queries: [{ type: "journals", query: "完全に無関係な語ZZZ", limit: 5 }],
    });
    expect(miss).toContain("一致するJournalはありません");
  });

  it("executeLookupのsimilarは未完了と状態不問を分けて返す", async () => {
    const suggestionStore = await import("./suggestion-store");
    await suggestionStore.createSuggestion("類似オープン");
    const done = await suggestionStore.createSuggestion("類似クローズ");
    await suggestionStore.setReviewStatus(done.id, "done");

    const { executeLookup } = await import("./agent-knowledge-tools");
    const text = await executeLookup({
      queries: [{ type: "similar", query: "育成の停滞", limit: 10 }],
    });
    expect(text).toContain("【類似・未完了の提案】");
    expect(text).toContain("【類似・状態不問の提案");
    expect(text).toContain("類似オープン");
  });

  it("executeLookupのsimilarはPERSON_nクエリを実名に戻してからembedする", async () => {
    const people = await import("./people-directory");
    const personId = people.registerName("花子");
    const seen: string[] = [];
    embedRef.impl = async (text: string) => {
      seen.push(text);
      return [1, 0, 0];
    };

    const { executeLookup } = await import("./agent-knowledge-tools");
    const text = await executeLookup({
      queries: [{ type: "similar", query: `${personId}の育成が停滞している`, limit: 5 }],
    });
    expect(seen.some((q) => q.includes("花子"))).toBe(true);
    expect(seen.every((q) => !q.includes(personId))).toBe(true);
    // 返却テキストのクエリ表示はマスクのまま（クラウドへ戻すため）
    expect(text).toContain(`クエリ: ${personId}の育成が停滞している`);
    expect(text).not.toMatch(/クエリ:.*花子/);
  });
});

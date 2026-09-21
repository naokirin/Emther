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

describe("related-context", () => {
  it("searchSimilarOpenSuggestionsは閾値以上の未完了提案だけ返す", async () => {
    const suggestionStore = await import("./suggestion-store");
    const a = await suggestionStore.createSuggestion("類似A");
    const b = await suggestionStore.createSuggestion("類似B");
    await suggestionStore.setReviewStatus(b.id, "done");
    const { searchSimilarOpenSuggestions, RELATED_SIMILARITY_THRESHOLD } = await import("./related-context");
    const hits = searchSimilarOpenSuggestions([1, 0, 0], { excludeId: a.id });
    expect(hits.every((h) => h.id !== a.id)).toBe(true);
    expect(hits.every((h) => h.reviewStatus !== "done")).toBe(true);
    expect(hits.every((h) => h.similarity >= RELATED_SIMILARITY_THRESHOLD)).toBe(true);
  });

  it("buildRelatedBundleBlockはjournal-analysisで繰り返しシグナルを載せる", async () => {
    const knowledge = await import("./knowledge-store");
    const now = Date.now();
    knowledge.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "1on1が形骸化している",
      tags: [],
      occurredAt: now,
      embedding: [1, 0, 0],
    });
    knowledge.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "また1on1が空回りした",
      tags: [],
      occurredAt: now - 1000,
      embedding: [0.99, 0.1, 0],
    });

    const { buildRelatedBundleBlock } = await import("./related-context");
    const block = await buildRelatedBundleBlock({
      queryText: "1on1が機能していない",
      mode: "journal-analysis",
    });
    expect(block).toContain("繰り返しシグナル");
    expect(block).toContain("関連するJournal");
  });

  it("buildRelatedBundleBlockはsuggestion-wallbashで関連提案を載せる", async () => {
    const suggestionStore = await import("./suggestion-store");
    const self = await suggestionStore.createSuggestion("対象");
    await suggestionStore.addMemo(self.id, "育成の停滞");
    await suggestionStore.createSuggestion("関連");
    const { buildRelatedBundleBlock } = await import("./related-context");
    const block = await buildRelatedBundleBlock({
      queryText: self.title,
      excludeSuggestionId: self.id,
      mode: "suggestion-wallbash",
    });
    expect(block).toContain("関連する未完了の提案");
    expect(block).toContain("関連");
    expect(block).not.toContain(self.id);
  });

  it("buildRelatedBundleBlockはヒット0件でも不在を明示する", async () => {
    embedRef.impl = async () => [0, 1, 0];
    const { buildRelatedBundleBlock } = await import("./related-context");
    const block = await buildRelatedBundleBlock({
      queryText: "全く無関係なクエリで類似ゼロを狙う",
      mode: "suggestion-wallbash",
    });
    expect(block).toContain("閾値以上の類似未完了提案なし");
    expect(block).toContain("lookup");
    expect(block).toContain("閾値以上の類似Journalなし");
  });
});

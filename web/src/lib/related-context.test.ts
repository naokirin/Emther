import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

const embedRef = vi.hoisted(() => ({
  impl: async (_text: string): Promise<number[]> => {
    void _text;
    return [1, 0, 0];
  },
}));

vi.mock("@/lib/embeddings", () => ({
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
  it("issueEmbedSourceはtitleとcharterを結合する", async () => {
    const { issueEmbedSource } = await import("@/lib/related-context");
    const text = issueEmbedSource({
      title: "1on1改善",
      charter: { why: "育成", what: "設計", how: "週次" },
      tags: ["people"],
    });
    expect(text).toContain("1on1改善");
    expect(text).toContain("Why: 育成");
    expect(text).toContain("タグ: people");
  });

  it("refreshIssueEmbeddingはembeddingを保存しupdatedAtを変えない", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("課題", undefined, { why: "理由" });
    const before = issue.updatedAt;
    // createIssue内でも refresh 済みだが、明示的に再実行して updatedAt 不変を確認する。
    const { refreshIssueEmbedding } = await import("@/lib/related-context");
    const updated = await refreshIssueEmbedding(issue.id);
    expect(updated?.embedding).toEqual([1, 0, 0]);
    expect(updated?.updatedAt).toBe(before);
    expect(issueStore.toIssueView(updated!).embedding).toBeUndefined();
  });

  it("searchSimilarOpenIssuesは閾値以上の未完了Issueだけ返す", async () => {
    const issueStore = await import("@/lib/issue-store");
    const a = await issueStore.createIssue("類似A");
    const b = await issueStore.createIssue("類似B");
    await issueStore.setIssueStatus(b.id, "done");
    const { searchSimilarOpenIssues, RELATED_SIMILARITY_THRESHOLD } = await import("@/lib/related-context");
    const hits = searchSimilarOpenIssues([1, 0, 0], { excludeId: a.id });
    expect(hits.every((h) => h.id !== a.id)).toBe(true);
    expect(hits.every((h) => h.status !== "done")).toBe(true);
    expect(hits.every((h) => h.similarity >= RELATED_SIMILARITY_THRESHOLD)).toBe(true);
  });

  it("buildRelatedBundleBlockはjournal-analysisで繰り返しシグナルを載せる", async () => {
    const knowledge = await import("@/lib/knowledge-store");
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

    const { buildRelatedBundleBlock } = await import("@/lib/related-context");
    const block = await buildRelatedBundleBlock({
      queryText: "1on1が機能していない",
      mode: "journal-analysis",
    });
    expect(block).toContain("繰り返しシグナル");
    expect(block).toContain("関連するJournal");
  });

  it("buildRelatedBundleBlockはissue-wallbashで関連Issueを載せる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const self = await issueStore.createIssue("対象", undefined, { why: "育成の停滞" });
    await issueStore.createIssue("関連", undefined, { why: "育成の停滞" });
    const { buildRelatedBundleBlock, issueEmbedSource } = await import("@/lib/related-context");
    const block = await buildRelatedBundleBlock({
      queryText: issueEmbedSource(self),
      excludeIssueId: self.id,
      mode: "issue-wallbash",
    });
    expect(block).toContain("関連する未完了Issue");
    expect(block).toContain("関連");
    expect(block).not.toContain(self.id);
  });
});

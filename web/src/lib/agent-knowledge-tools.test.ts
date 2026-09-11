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

describe("agent-knowledge-tools", () => {
  it("extractLookupはqueriesをパースし上限で切る", async () => {
    const { extractLookup, LOOKUP_MAX_QUERIES } = await import("@/lib/agent-knowledge-tools");
    const queries = Array.from({ length: LOOKUP_MAX_QUERIES + 2 }, (_, i) => ({
      type: "issues",
      query: `q${i}`,
    }));
    const req = extractLookup(`\`\`\`lookup\n${JSON.stringify({ reason: "確認", queries })}\n\`\`\``);
    expect(req?.reason).toBe("確認");
    expect(req?.queries).toHaveLength(LOOKUP_MAX_QUERIES);
    expect(req?.queries.every((q) => q.type === "issues")).toBe(true);
  });

  it("extractLookupは不正・空でundefined", async () => {
    const { extractLookup } = await import("@/lib/agent-knowledge-tools");
    expect(extractLookup("no block")).toBeUndefined();
    expect(extractLookup('```lookup\n{ "queries": [] }\n```')).toBeUndefined();
    expect(extractLookup('```lookup\n{ "queries": [{ "type": "issues" }] }\n```')).toBeUndefined();
  });

  it("executeLookupのissuesはキーワード一致と不在を返す", async () => {
    const issueStore = await import("@/lib/issue-store");
    await issueStore.createIssue("Copilot Workspace 導入", undefined, { why: "開発体験" });
    await issueStore.createIssue("別件オンボーディング");

    const { executeLookup } = await import("@/lib/agent-knowledge-tools");
    const hit = await executeLookup({
      queries: [{ type: "issues", query: "Copilot Workspace", limit: 10 }],
    });
    expect(hit).toContain("Copilot Workspace 導入");
    expect(hit).toContain("ヒット=1");

    const miss = await executeLookup({
      queries: [{ type: "issues", query: "存在しないキーワードXYZ", limit: 10 }],
    });
    expect(miss).toContain("一致するIssueはありません");
    expect(miss).toContain("ヒット=0");
  });

  it("executeLookupのissuesはincludeDoneで完了済みも拾う", async () => {
    const issueStore = await import("@/lib/issue-store");
    const done = await issueStore.createIssue("完了したCopilot課題");
    await issueStore.setIssueStatus(done.id, "done");

    const { executeLookup } = await import("@/lib/agent-knowledge-tools");
    const withoutDone = await executeLookup({
      queries: [{ type: "issues", query: "Copilot", includeDone: false }],
    });
    expect(withoutDone).toContain("ヒット=0");

    const withDone = await executeLookup({
      queries: [{ type: "issues", query: "Copilot", includeDone: true }],
    });
    expect(withDone).toContain("完了したCopilot課題");
    expect(withDone).toContain("ヒット=1");
  });

  it("executeLookupのissueはID詳細を返す", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("詳細確認用", undefined, {
      why: "理由本文",
      what: "何をやるか",
    });
    const { executeLookup } = await import("@/lib/agent-knowledge-tools");
    const text = await executeLookup({ queries: [{ type: "issue", id: issue.id }] });
    expect(text).toContain(issue.id);
    expect(text).toContain("詳細確認用");
    expect(text).toContain("What: 何をやるか");

    const missing = await executeLookup({ queries: [{ type: "issue", id: "no-such-id" }] });
    expect(missing).toContain("見つかりませんでした");
  });

  it("executeLookupのjournalsはキーワード検索する", async () => {
    const knowledge = await import("@/lib/knowledge-store");
    knowledge.recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: [],
      text: "今日の1on1でCopilotの話が出た",
      tags: [],
      occurredAt: Date.now(),
    });

    const { executeLookup } = await import("@/lib/agent-knowledge-tools");
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
    const issueStore = await import("@/lib/issue-store");
    await issueStore.createIssue("類似オープン", undefined, { why: "育成" });
    const done = await issueStore.createIssue("類似クローズ", undefined, { why: "育成" });
    await issueStore.setIssueStatus(done.id, "done");

    const { executeLookup } = await import("@/lib/agent-knowledge-tools");
    const text = await executeLookup({
      queries: [{ type: "similar", query: "育成の停滞", limit: 10 }],
    });
    expect(text).toContain("【類似・未完了Issue】");
    expect(text).toContain("【類似・状態不問のIssue");
    expect(text).toContain("類似オープン");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/name-candidate-detect", () => ({
  detectNameCandidatesAsync: async () => [] as string[],
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: async () => [1, 0, 0],
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

describe("migrateLegacyIssueToSuggestion", () => {
  it("IDを維持し、archived/doneを確認済みにし、charterをメモへ移す", async () => {
    const { migrateLegacyIssueToSuggestion } = await import("@/lib/suggestion-store");
    const s = migrateLegacyIssueToSuggestion({
      id: "issue-keep-id",
      title: "滞留レビュー",
      status: "in_progress",
      archived: true,
      archivedAt: 100,
      priority: "focus",
      focusOrder: 2,
      charter: { why: "理由", what: "内容", how: "" },
      logEntries: [{ id: "log1", text: "既存ログ", createdAt: 50 }],
      agentRunId: "run-1",
      sourceJournalId: "j-1",
      teamId: "t-1",
      createdAt: 10,
      updatedAt: 90,
    });
    expect(s.id).toBe("issue-keep-id");
    expect(s.reviewStatus).toBe("done");
    expect(s.confirmPriority).toBe("focus");
    expect(s.focusOrder).toBe(2);
    expect(s.agentRunId).toBe("run-1");
    expect(s.sourceJournalId).toBe("j-1");
    expect(s.teamId).toBe("t-1");
    expect(s.memos.some((m) => m.text.includes("（旧 Why/What/How）") && m.text.includes("Why: 理由"))).toBe(true);
    expect(s.memos.some((m) => m.text === "既存ログ")).toBe(true);
  });

  it("未アーカイブ・非doneは未確認になる", async () => {
    const { migrateLegacyIssueToSuggestion } = await import("@/lib/suggestion-store");
    const s = migrateLegacyIssueToSuggestion({
      id: "a",
      title: "t",
      status: "not_started",
      archived: false,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(s.reviewStatus).toBe("unreviewed");
  });

  it("status=doneも確認済みになる", async () => {
    const { migrateLegacyIssueToSuggestion } = await import("@/lib/suggestion-store");
    const s = migrateLegacyIssueToSuggestion({
      id: "a",
      title: "t",
      status: "done",
      archived: false,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(s.reviewStatus).toBe("done");
  });
});

describe("suggestion-store load migration", () => {
  it("suggestions.jsonが無いときissues.jsonから移行してIDを保つ", async () => {
    mkdirSync(join(dir, "data"), { recursive: true });
    writeFileSync(
      join(dir, "data", "issues.json"),
      JSON.stringify([
        {
          id: "legacy-uuid",
          title: "旧Issue",
          charter: { why: "", what: "", how: "" },
          actionItems: [],
          logEntries: [],
          status: "not_started",
          priority: "normal",
          archived: false,
          tags: [],
          createdAt: 1,
          updatedAt: 2,
        },
      ]),
    );
    const store = await import("@/lib/suggestion-store");
    const list = store.listSuggestions();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("legacy-uuid");
    expect(list[0].title).toBe("旧Issue");
  });
});

describe("createSuggestion / review / memo", () => {
  it("作成・確認状態・メモ追記ができる", async () => {
    const store = await import("@/lib/suggestion-store");
    const s = await store.createSuggestion("新しい提案", { confirmPriority: "focus" });
    expect(s.reviewStatus).toBe("unreviewed");
    expect(s.confirmPriority).toBe("focus");
    store.setReviewStatus(s.id, "deferred");
    expect(store.getSuggestion(s.id)?.reviewStatus).toBe("deferred");
    await store.addMemo(s.id, "壁打ちメモ");
    expect(store.getSuggestion(s.id)?.memos.at(-1)?.text).toBe("壁打ちメモ");
    store.setReviewStatus(s.id, "done");
    expect(store.getSuggestion(s.id)?.reviewStatus).toBe("done");
  });
});

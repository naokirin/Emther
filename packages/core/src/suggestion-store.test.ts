import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "./test-helpers/store-env";

vi.mock("./local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("./name-candidate-detect", () => ({
  detectNameCandidatesAsync: async () => [] as string[],
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
}));

vi.mock("./embeddings", () => ({
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
    const { migrateLegacyIssueToSuggestion } = await import("./suggestion-store");
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
    expect(s.memos.find((m) => m.text.includes("（旧 Why/What/How）"))?.source).toBe("agent");
    expect(s.memos.some((m) => m.text === "既存ログ")).toBe(true);
  });

  it("未アーカイブ・非doneは未確認になる", async () => {
    const { migrateLegacyIssueToSuggestion } = await import("./suggestion-store");
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
    const { migrateLegacyIssueToSuggestion } = await import("./suggestion-store");
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
    const store = await import("./suggestion-store");
    const list = store.listSuggestions();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("legacy-uuid");
    expect(list[0].title).toBe("旧Issue");
  });
});

describe("createSuggestion / review / memo", () => {
  it("作成・確認状態・メモ追記ができる", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("新しい提案", { confirmPriority: "focus" });
    expect(s.reviewStatus).toBe("unreviewed");
    expect(s.confirmPriority).toBe("focus");
    store.setReviewStatus(s.id, "deferred");
    expect(store.getSuggestion(s.id)?.reviewStatus).toBe("deferred");
    await store.addMemo(s.id, "壁打ちメモ");
    expect(store.getSuggestion(s.id)?.memos.at(-1)?.text).toBe("壁打ちメモ");
    expect(store.getSuggestion(s.id)?.memos.at(-1)?.source).toBe("user");
    await store.updateSuggestionCharter(s.id, { why: "なぜ" });
    expect(store.getSuggestion(s.id)?.memos.at(-1)?.source).toBe("agent");
    expect(store.getSuggestion(s.id)?.memos.at(-1)?.text).toContain("（Charter更新）");
    store.setReviewStatus(s.id, "done");
    expect(store.getSuggestion(s.id)?.reviewStatus).toBe("done");
  });

  it("確認中(in_review)ステータスへ変更できる", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("検討中の提案");
    const updated = store.setReviewStatus(s.id, "in_review");
    expect(updated?.reviewStatus).toBe("in_review");
    expect(updated?.reviewedAt).toBeTypeOf("number");
  });
});

describe("createSuggestion detail / setSuggestionDetail", () => {
  it("detailを渡して作成すると保持され、toSuggestionViewでunmaskされる", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("詳細つき提案", {
      detail: { conclusion: "結論文", facts: ["根拠1"], logic: "ロジック", advice: "助言" },
    });
    expect(s.detail?.conclusion).toBe("結論文");
    expect(s.detail?.facts).toEqual(["根拠1"]);
    expect(s.detail?.adviceStructured?.overview).toBe("助言");
    expect(s.detail?.updatedAt).toBeTypeOf("number");
    const view = store.toSuggestionView(store.getSuggestion(s.id)!);
    expect(view.detail?.conclusion).toBe("結論文");
  });

  it("conclusion/logicが空のdetailは無視される", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("詳細なし提案", {
      detail: { conclusion: "", facts: [], logic: "" },
    });
    expect(s.detail).toBeUndefined();
  });

  it("setSuggestionDetailで詳細を後から更新できる", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("後から詳細を足す提案");
    expect(s.detail).toBeUndefined();
    const updated = store.setSuggestionDetail(s.id, { conclusion: "更新結論", facts: [], logic: "更新ロジック" });
    expect(updated?.detail?.conclusion).toBe("更新結論");
    expect(store.getSuggestion(s.id)?.detail?.logic).toBe("更新ロジック");
  });

  it("存在しないIDにはundefinedを返す", async () => {
    const store = await import("./suggestion-store");
    expect(store.setSuggestionDetail("nope", { conclusion: "c", facts: [], logic: "l" })).toBeUndefined();
  });
});

describe("updateSuggestionDetail", () => {
  it("詳細が無い状態からEMが新規に書き起こせる", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("EMが詳細を書く提案");
    const updated = await store.updateSuggestionDetail(s.id, {
      conclusion: "EMの結論",
      facts: ["事実1", "事実2"],
      logic: "EMのロジック",
      advice: "EMの助言",
    });
    expect(updated?.detail?.conclusion).toBe("EMの結論");
    expect(updated?.detail?.facts).toEqual(["事実1", "事実2"]);
    expect(updated?.detail?.adviceOverride).toBe("EMの助言");
  });

  it("advice編集はadviceOverrideに保存し、adviceStructuredは保持する", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("構造あり提案", {
      detail: {
        conclusion: "c",
        facts: [],
        logic: "l",
        adviceStructured: {
          overview: "AI版",
          groups: [{ nextActions: ["動く"] }],
        },
      },
    });
    const updated = await store.updateSuggestionDetail(s.id, { advice: "EMの版" });
    expect(updated?.detail?.adviceOverride).toBe("EMの版");
    expect(updated?.detail?.adviceStructured?.overview).toBe("AI版");
  });

  it("setSuggestionDetailはadviceOverrideを保持する", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("override保持", {
      detail: {
        conclusion: "c",
        facts: [],
        logic: "l",
        adviceStructured: { overview: "旧AI", groups: [] },
      },
    });
    await store.updateSuggestionDetail(s.id, { advice: "EM編集" });
    const refreshed = store.setSuggestionDetail(s.id, {
      conclusion: "c2",
      facts: [],
      logic: "l2",
      adviceStructured: { overview: "新AI", groups: [{ nextActions: ["確認"] }] },
    });
    expect(refreshed?.detail?.adviceOverride).toBe("EM編集");
    expect(refreshed?.detail?.adviceStructured?.overview).toBe("新AI");
    expect(refreshed?.detail?.conclusion).toBe("c2");
  });

  it("adviceを空文字で保存するとoverrideを消し構造表示に戻る", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("クリア", {
      detail: {
        conclusion: "c",
        facts: [],
        logic: "l",
        adviceStructured: { overview: "AI", groups: [] },
      },
    });
    await store.updateSuggestionDetail(s.id, { advice: "EM" });
    const cleared = await store.updateSuggestionDetail(s.id, { advice: "" });
    expect(cleared?.detail?.adviceOverride).toBeUndefined();
    expect(cleared?.detail?.adviceStructured?.overview).toBe("AI");
  });

  it("一部フィールドだけの部分更新では、他のフィールドの現在値を保つ", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("部分更新の提案", {
      detail: { conclusion: "元の結論", facts: ["元の事実"], logic: "元のロジック" },
    });
    const updated = await store.updateSuggestionDetail(s.id, { logic: "書き直したロジック" });
    expect(updated?.detail?.conclusion).toBe("元の結論");
    expect(updated?.detail?.facts).toEqual(["元の事実"]);
    expect(updated?.detail?.logic).toBe("書き直したロジック");
  });

  it("conclusion/logicを空にする更新は拒否される", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("空にできない提案", {
      detail: { conclusion: "結論", facts: [], logic: "ロジック" },
    });
    await expect(store.updateSuggestionDetail(s.id, { conclusion: "  " })).rejects.toThrow("必須です");
  });

  it("存在しないIDにはundefinedを返す", async () => {
    const store = await import("./suggestion-store");
    const updated = await store.updateSuggestionDetail("nope", { conclusion: "c", facts: [], logic: "l" });
    expect(updated).toBeUndefined();
  });
});

describe("setSuggestionReviewDueAt", () => {
  it("確認期日を設定・解除できる。reviewStatusとは独立に変更できる", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("期日つきの提案");
    expect(s.reviewDueAt).toBeUndefined();

    const withDue = store.setSuggestionReviewDueAt(s.id, 12345);
    expect(withDue?.reviewDueAt).toBe(12345);
    expect(withDue?.reviewStatus).toBe("unreviewed");

    const cleared = store.setSuggestionReviewDueAt(s.id, null);
    expect(cleared?.reviewDueAt).toBeUndefined();
  });

  it("存在しないIDにはundefinedを返す", async () => {
    const store = await import("./suggestion-store");
    expect(store.setSuggestionReviewDueAt("no-such-id", 1)).toBeUndefined();
  });
});

describe("archiveSuggestion / unarchiveSuggestion", () => {
  it("reviewStatusを変えずにarchivedAtだけを立てる／解除できる", async () => {
    const store = await import("./suggestion-store");
    const s = await store.createSuggestion("重複して起票してしまった提案");
    expect(s.archivedAt).toBeUndefined();

    const archived = store.archiveSuggestion(s.id);
    expect(archived?.archivedAt).toBeTypeOf("number");
    expect(archived?.reviewStatus).toBe("unreviewed");

    const unarchived = store.unarchiveSuggestion(s.id);
    expect(unarchived?.archivedAt).toBeUndefined();
    expect(unarchived?.reviewStatus).toBe("unreviewed");
  });
});

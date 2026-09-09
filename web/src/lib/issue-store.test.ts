import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModule() {
  return import("@/lib/issue-store");
}

describe("createIssue", () => {
  it("createIssueのopts.priorityでフォーカス優先度を付けられる", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("重要介入", undefined, undefined, undefined, undefined, undefined, undefined, {
      priority: "focus",
    });
    expect(issue.priority).toBe("focus");
    expect(issue.focusOrder).toBe(0);
  });

  it("タイトル・空のcharter/actionItems/logEntriesで作成する", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("障害対応プロセスの整理");
    expect(issue.title).toBe("障害対応プロセスの整理");
    expect(issue.charter).toEqual({ why: "", what: "", how: "" });
    expect(issue.actionItems).toEqual([]);
    expect(issue.logEntries).toEqual([]);
    expect(issue.archived).toBe(false);
    expect(issue.parentId).toBeUndefined();
  });

  it("charterを指定して作成できる", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A", undefined, { why: "理由", what: "内容", how: "方法" });
    expect(issue.charter).toEqual({ why: "理由", what: "内容", how: "方法" });
  });

  it("親子は1階層のみ許可し、既に子であるIssueの下に作ろうとするとエラー", async () => {
    const store = await loadModule();
    const parent = await store.createIssue("親Issue");
    const child = await store.createIssue("子Issue", undefined, undefined, parent.id);
    expect(child.parentId).toBe(parent.id);

    await expect(store.createIssue("孫Issue", undefined, undefined, child.id)).rejects.toThrow(
      "これ以上下に分解できません",
    );
  });

  it("存在しない親IDを指定するとエラー", async () => {
    const store = await loadModule();
    await expect(store.createIssue("Issue", undefined, undefined, "missing-id")).rejects.toThrow(
      "親Issueが見つかりません",
    );
  });

  it("tagsは重複除去・trimされる", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue", undefined, undefined, undefined, ["技術的負債", " 技術的負債 ", "1on1"]);
    expect(issue.tags).toEqual(["技術的負債", "1on1"]);
  });
});

describe("createParentIssue", () => {
  it("既存Issueの上位Issueを作り、既存Issueをその子として付け替える", async () => {
    const store = await loadModule();
    const child = await store.createIssue("既存Issue");
    const parent = await store.createParentIssue(child.id, "上位Issue");
    const updatedChild = store.getIssue(child.id);
    expect(updatedChild?.parentId).toBe(parent.id);
  });

  it("既に子を持つIssueに対してはエラー", async () => {
    const store = await loadModule();
    const parent = await store.createIssue("親Issue");
    await store.createIssue("子Issue", undefined, undefined, parent.id);
    await expect(store.createParentIssue(parent.id, "祖父Issue")).rejects.toThrow("既に子Issueがある");
  });

  it("既に子であるIssueに対してはエラー", async () => {
    const store = await loadModule();
    const parent = await store.createIssue("親Issue");
    const child = await store.createIssue("子Issue", undefined, undefined, parent.id);
    await expect(store.createParentIssue(child.id, "さらに上位")).rejects.toThrow("既に子Issueのため");
  });
});

describe("charter / title / action items / log entries", () => {
  it("updateIssueCharterは指定フィールドだけ更新する", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A", undefined, { why: "旧why" });
    const updated = await store.updateIssueCharter(issue.id, { what: "新しいwhat" });
    expect(updated?.charter).toEqual({ why: "旧why", what: "新しいwhat", how: "" });
  });

  it("updateIssueCharterは未変更フィールドでローカルNERを走らせない", async () => {
    const { runLocalChat } = await import("@/lib/local-model");
    const store = await loadModule();
    const issue = await store.createIssue("Issue A", undefined, { why: "理由", what: "内容", how: "方法" });
    vi.mocked(runLocalChat).mockClear();

    const updated = await store.updateIssueCharter(issue.id, { why: "理由", what: "内容", how: "方法" });
    expect(updated?.charter).toEqual({ why: "理由", what: "内容", how: "方法" });
    expect(runLocalChat).not.toHaveBeenCalled();
  });

  it("updateIssueCharterは既定でNERを走らせない（事前登録が正）", async () => {
    const { runLocalChat } = await import("@/lib/local-model");
    const store = await loadModule();
    const issue = await store.createIssue("Issue A", undefined, { why: "理由", what: "内容", how: "方法" });
    vi.mocked(runLocalChat).mockClear();

    const updated = await store.updateIssueCharter(issue.id, {
      why: "理由",
      what: "新しい内容",
      how: "方法",
    });
    expect(updated?.charter.what).toBe("新しい内容");
    expect(runLocalChat).not.toHaveBeenCalled();
  });

  it("updateIssueCharterは明示オプトイン時、変更フィールドだけをまとめて1回NERする", async () => {
    const { runLocalChat } = await import("@/lib/local-model");
    const store = await loadModule();
    const issue = await store.createIssue("Issue A", undefined, { why: "理由", what: "内容", how: "方法" });
    vi.mocked(runLocalChat).mockClear();

    const updated = await store.updateIssueCharter(
      issue.id,
      {
        why: "理由",
        what: "新しい内容",
        how: "方法",
      },
      { allowUnmaskedCandidates: true },
    );
    expect(updated?.charter.what).toBe("新しい内容");
    expect(runLocalChat).toHaveBeenCalledTimes(1);
  });

  it("setIssueTitleは空文字を拒否する", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    await expect(store.setIssueTitle(issue.id, "   ")).rejects.toThrow("titleは必須です");
  });

  it("setIssueTitleはタイトルを更新する", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    const updated = await store.setIssueTitle(issue.id, "Issue A改題");
    expect(updated?.title).toBe("Issue A改題");
  });

  it("setIssueTitleは未変更ならローカルNERを走らせない", async () => {
    const { runLocalChat } = await import("@/lib/local-model");
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    vi.mocked(runLocalChat).mockClear();
    const updated = await store.setIssueTitle(issue.id, "Issue A");
    expect(updated?.title).toBe("Issue A");
    expect(runLocalChat).not.toHaveBeenCalled();
  });

  it("addActionItem/toggleActionItemで完了状態を切り替えられる", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    const withItem = await store.addActionItem(issue.id, "レビューを依頼する");
    const itemId = withItem!.actionItems[0].id;
    expect(withItem!.actionItems[0].done).toBe(false);

    const toggled = store.toggleActionItem(issue.id, itemId);
    expect(toggled?.actionItems[0].done).toBe(true);
    const toggledAgain = store.toggleActionItem(issue.id, itemId);
    expect(toggledAgain?.actionItems[0].done).toBe(false);
  });

  it("空白のみのaddActionItemは追加しない", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    const result = await store.addActionItem(issue.id, "   ");
    expect(result?.actionItems).toHaveLength(0);
  });

  it("asNextで先頭に挿入し、setActionItemAsNextで繰り上げできる", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    await store.addActionItem(issue.id, "後で");
    const withNext = await store.addActionItem(issue.id, "今やる", { asNext: true });
    expect(withNext!.actionItems.map((a) => a.text)).toEqual(["今やる", "後で"]);

    const moved = store.setActionItemAsNext(issue.id, withNext!.actionItems[1].id);
    expect(moved!.actionItems.map((a) => a.text)).toEqual(["後で", "今やる"]);
  });

  it("promoteActionItemToChildIssueは子Issueを作り元を完了にする", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("親Issue");
    const withItem = await store.addActionItem(issue.id, "別介入として切り出す");
    const itemId = withItem!.actionItems[0].id;
    const result = await store.promoteActionItemToChildIssue(issue.id, itemId);
    expect(result?.child.parentId).toBe(issue.id);
    expect(result?.child.title).toBe("別介入として切り出す");
    expect(result?.parent.actionItems[0].done).toBe(true);
  });

  it("子Issueからは昇格できない", async () => {
    const store = await loadModule();
    const parent = await store.createIssue("親");
    const child = await store.createIssue("子", undefined, undefined, parent.id);
    const withItem = await store.addActionItem(child.id, "一手");
    await expect(store.promoteActionItemToChildIssue(child.id, withItem!.actionItems[0].id)).rejects.toThrow(/1階層/);
  });

  it("setIssuePriorityでfocusになり、moveFocusIssueで順序が入れ替わる", async () => {
    const store = await loadModule();
    const a = await store.createIssue("A");
    const b = await store.createIssue("B");
    store.setIssuePriority(a.id, "focus");
    store.setIssuePriority(b.id, "focus");
    expect(store.getIssue(a.id)?.focusOrder).toBe(0);
    expect(store.getIssue(b.id)?.focusOrder).toBe(1);
    store.moveFocusIssue(b.id, "up");
    expect(store.getIssue(a.id)?.focusOrder).toBe(1);
    expect(store.getIssue(b.id)?.focusOrder).toBe(0);
    store.setIssuePriority(b.id, "parked");
    expect(store.getIssue(b.id)?.focusOrder).toBeUndefined();
    expect(store.getIssue(a.id)?.focusOrder).toBe(0);
  });

  it("addLogEntryは自由記述ログを積み上げる", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    const updated = await store.addLogEntry(issue.id, "1on1で状況確認した");
    expect(updated?.logEntries).toHaveLength(1);
    expect(updated?.logEntries[0].text).toBe("1on1で状況確認した");
  });
});

describe("archive / keyResult / team / tags", () => {
  it("setIssueArchivedはarchivedAtを設定・解除する", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    const archived = store.setIssueArchived(issue.id, true);
    expect(archived?.archived).toBe(true);
    expect(archived?.archivedAt).toBeDefined();

    const unarchived = store.setIssueArchived(issue.id, false);
    expect(unarchived?.archived).toBe(false);
    expect(unarchived?.archivedAt).toBeUndefined();
  });

  it("setIssueKeyResult/setIssueTeamはnullで解除できる", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    const withKr = store.setIssueKeyResult(issue.id, "kr-1");
    expect(withKr?.keyResultId).toBe("kr-1");
    const cleared = store.setIssueKeyResult(issue.id, null);
    expect(cleared?.keyResultId).toBeUndefined();

    const withTeam = store.setIssueTeam(issue.id, "team-1");
    expect(withTeam?.teamId).toBe("team-1");
    const clearedTeam = store.setIssueTeam(issue.id, null);
    expect(clearedTeam?.teamId).toBeUndefined();
  });

  it("setIssueTagsは重複除去・trimして更新する", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    const updated = store.setIssueTags(issue.id, ["a", " a ", "b"]);
    expect(updated?.tags).toEqual(["a", "b"]);
  });
});

describe("listIssues / listChildIssues / getIssueByRunId", () => {
  it("listIssuesは更新日時の新しい順で返す", async () => {
    const store = await loadModule();
    const older = await store.createIssue("Older");
    await new Promise((r) => setTimeout(r, 2));
    const newer = await store.createIssue("Newer");
    const list = store.listIssues();
    expect(list[0].id).toBe(newer.id);
    expect(list[1].id).toBe(older.id);
  });

  it("listChildIssuesは指定した親のIssueのみ返す", async () => {
    const store = await loadModule();
    const parent = await store.createIssue("親");
    const child = await store.createIssue("子", undefined, undefined, parent.id);
    await store.createIssue("無関係のIssue");
    expect(store.listChildIssues(parent.id).map((i) => i.id)).toEqual([child.id]);
  });

  it("getIssueByRunIdはagentRunIdで検索する", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("AI起点のIssue", "run-123");
    expect(store.getIssueByRunId("run-123")?.id).toBe(issue.id);
    expect(store.getIssueByRunId("run-unknown")).toBeUndefined();
  });

  it("linkIssueRunは後からagentRunIdを紐づける", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("素のIssue");
    expect(issue.agentRunId).toBeUndefined();
    const linked = store.linkIssueRun(issue.id, "run-456");
    expect(linked?.agentRunId).toBe("run-456");
    expect(store.getIssueByRunId("run-456")?.id).toBe(issue.id);
  });

  it("linkIssueRunは存在しないIssueならundefined", async () => {
    const store = await loadModule();
    expect(store.linkIssueRun("missing", "run-456")).toBeUndefined();
  });
});

describe("status", () => {
  it("createIssueの既定statusはnot_started", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    expect(issue.status).toBe("not_started");
  });

  it("addActionItemでnot_startedからin_progressへ自動昇格する", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    const updated = await store.addActionItem(issue.id, "レビューを依頼する");
    expect(updated?.status).toBe("in_progress");
  });

  it("addLogEntryでnot_startedからin_progressへ自動昇格する", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    const updated = await store.addLogEntry(issue.id, "状況確認した");
    expect(updated?.status).toBe("in_progress");
  });

  it("setIssueStatusでblockedにした後はAction Item追加で上書きされない", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    store.setIssueStatus(issue.id, "blocked");
    const updated = await store.addActionItem(issue.id, "待ち");
    expect(updated?.status).toBe("blocked");
  });

  it("setIssueArchived(true)でstatusがdoneになり、解除するとin_progressに戻る", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    const archived = store.setIssueArchived(issue.id, true);
    expect(archived?.status).toBe("done");
    const unarchived = store.setIssueArchived(issue.id, false);
    expect(unarchived?.status).toBe("in_progress");
  });

  it("setIssueStatusは同じ値なら変更履歴を増やさず現状を返す", async () => {
    const store = await loadModule();
    const issue = await store.createIssue("Issue A");
    const result = store.setIssueStatus(issue.id, "not_started");
    expect(result?.status).toBe("not_started");
  });

  it("存在しないIssueIdはundefined", async () => {
    const store = await loadModule();
    expect(store.setIssueStatus("missing", "blocked")).toBeUndefined();
  });
});

describe("toIssueView", () => {
  it("PERSON_n IDでマスクされたフィールドを実名復元する", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const store = await loadModule();
    peopleDirectory.registerName("Aさん");
    const issue = await store.createIssue("Aさんの育成", undefined, { why: "Aさんのため" });
    expect(issue.title).not.toBe("Aさんの育成");
    const view = store.toIssueView(issue);
    expect(view.title).toBe("Aさんの育成");
    expect(view.charter.why).toBe("Aさんのため");
  });
});

describe("自動分析のpending登録タイミング", () => {
  it("updateIssueCharterの完了時点でpendingAgentStartsに載っている（レスポンス前に予約完了）", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ autoIssueUpdateAnalysisEnabled: true });
    const rt = await import("@/lib/agent-runtime");
    rt.setIssueUpdateDebounceMsForTest(45_000);

    const store = await loadModule();
    const issue = await store.createIssue("課題");
    await store.updateIssueCharter(issue.id, { why: "なぜ今か" });

    // fire-and-forgetだとここで空になり得る。await済みなら即存在する。
    const pending = rt.listPendingAgentStarts();
    expect(pending).toHaveLength(1);
    expect(pending[0].issueId).toBe(issue.id);
  });

  it("addLogEntryの完了時点でもpendingAgentStartsに載っている", async () => {
    const settingsStore = await import("@/lib/settings-store");
    settingsStore.updateRulesAndConstraints({ autoIssueUpdateAnalysisEnabled: true });
    const rt = await import("@/lib/agent-runtime");
    rt.setIssueUpdateDebounceMsForTest(45_000);

    const store = await loadModule();
    const issue = await store.createIssue("課題");
    await store.addLogEntry(issue.id, "対応を始めた");

    const pending = rt.listPendingAgentStarts();
    expect(pending).toHaveLength(1);
    expect(pending[0].issueId).toBe(issue.id);
    expect(pending[0].label).toContain("経過ログ");
  });
});

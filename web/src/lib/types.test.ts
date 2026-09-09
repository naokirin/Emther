import { describe, expect, it } from "vitest";
import {
  charterFilledCount,
  compareIssuesByPriority,
  isIssueActive,
  isIssueStalled,
  isJournalEntryResolved,
  isRunStale,
  issueBacklogActionItems,
  issueNextAction,
  issueProgress,
  normalizeTeamName,
  personVitalStatus,
  teamDisplayName,
  teamPathSegments,
  truncateForTitle,
  type Issue,
  type IssueCharter,
  type JournalEntry,
} from "@/lib/types";

describe("teamPathSegments", () => {
  it("「/」区切りで分割し前後の空白を除去する", () => {
    expect(teamPathSegments("Engineering / Team A")).toEqual(["Engineering", "Team A"]);
  });

  it("区切りが無ければ1要素の配列になる", () => {
    expect(teamPathSegments("Engineering")).toEqual(["Engineering"]);
  });

  it("空セグメントは除外する", () => {
    expect(teamPathSegments("Engineering//Team A/")).toEqual(["Engineering", "Team A"]);
  });

  it("空文字は空配列になる", () => {
    expect(teamPathSegments("")).toEqual([]);
  });
});

describe("normalizeTeamName", () => {
  it("表記ゆれ（空白の有無）を吸収する", () => {
    expect(normalizeTeamName("Engineering / Team A")).toBe(normalizeTeamName("Engineering/Team A"));
    expect(normalizeTeamName("Engineering/Team A")).toBe("Engineering/Team A");
  });

  it("セグメントが無い場合はtrimしただけの値を返す", () => {
    expect(normalizeTeamName("   ")).toBe("");
  });
});

describe("teamDisplayName", () => {
  it("パンくず風に「 / 」区切りで表示する", () => {
    expect(teamDisplayName("Engineering/Team A")).toBe("Engineering / Team A");
  });

  it("セグメントが無い場合は元の値をそのまま返す", () => {
    expect(teamDisplayName("")).toBe("");
  });
});

describe("isRunStale", () => {
  it("statusがactiveでなければ常にfalse", () => {
    expect(isRunStale("idle", Date.now() - 1_000_000, 10)).toBe(false);
  });

  it("activeでも閾値以内ならfalse", () => {
    expect(isRunStale("active", Date.now() - 5_000, 120)).toBe(false);
  });

  it("activeで閾値を超えていればtrue", () => {
    expect(isRunStale("active", Date.now() - 200_000, 120)).toBe(true);
  });
});

describe("charterFilledCount", () => {
  it("空文字のフィールドは数えない", () => {
    const charter: IssueCharter = { why: "", what: "", how: "" };
    expect(charterFilledCount(charter)).toBe(0);
  });

  it("空白のみのフィールドも未入力扱いにする", () => {
    const charter: IssueCharter = { why: "  ", what: "x", how: "" };
    expect(charterFilledCount(charter)).toBe(1);
  });

  it("全項目埋まっていれば3", () => {
    const charter: IssueCharter = { why: "a", what: "b", how: "c" };
    expect(charterFilledCount(charter)).toBe(3);
  });
});

function baseIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    title: "Issue",
    charter: { why: "", what: "", how: "" },
    actionItems: [],
    logEntries: [],
    status: "not_started",
    priority: "normal",
    archived: false,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("issueProgress", () => {
  it("Action Itemの完了数を数える", () => {
    const issue = baseIssue({
      actionItems: [
        { id: "1", text: "a", done: true },
        { id: "2", text: "b", done: false },
      ],
    });
    expect(issueProgress(issue)).toEqual({ done: 1, total: 2 });
  });

  it("子Issueの完了（status:done）を合算し、archivedな子は分母からも外す", () => {
    const issue = baseIssue();
    const children = [
      baseIssue({ id: "c1", status: "done" }),
      baseIssue({ id: "c2", archived: true, status: "in_progress" }),
      baseIssue({ id: "c3" }),
    ];
    expect(issueProgress(issue, children)).toEqual({ done: 1, total: 2 });
  });

  it("項目が無ければ0/0", () => {
    expect(issueProgress(baseIssue())).toEqual({ done: 0, total: 0 });
  });
});

describe("isIssueActive", () => {
  it("archivedまたはdoneなら非アクティブ", () => {
    expect(isIssueActive(baseIssue())).toBe(true);
    expect(isIssueActive(baseIssue({ archived: true }))).toBe(false);
    expect(isIssueActive(baseIssue({ status: "done" }))).toBe(false);
  });
});

describe("issueNextAction / issueBacklogActionItems", () => {
  it("未完了の先頭が次の一手", () => {
    const issue = baseIssue({
      actionItems: [
        { id: "1", text: "done", done: true },
        { id: "2", text: "next", done: false },
        { id: "3", text: "later", done: false },
      ],
    });
    expect(issueNextAction(issue)).toEqual({ id: "2", text: "next", done: false });
    expect(issueBacklogActionItems(issue)).toEqual([{ id: "3", text: "later", done: false }]);
  });

  it("未完了が無ければundefined / 空", () => {
    const issue = baseIssue({ actionItems: [{ id: "1", text: "a", done: true }] });
    expect(issueNextAction(issue)).toBeUndefined();
    expect(issueBacklogActionItems(issue)).toEqual([]);
  });
});

describe("compareIssuesByPriority", () => {
  it("focus → normal → parked の順で並べる", () => {
    const parked = baseIssue({ id: "p", priority: "parked", updatedAt: 100 });
    const normal = baseIssue({ id: "n", priority: "normal", updatedAt: 50 });
    const focus = baseIssue({ id: "f", priority: "focus", focusOrder: 0, updatedAt: 10 });
    expect([parked, normal, focus].sort(compareIssuesByPriority).map((i) => i.id)).toEqual(["f", "n", "p"]);
  });

  it("focus同士はfocusOrder昇順", () => {
    const a = baseIssue({ id: "a", priority: "focus", focusOrder: 2, updatedAt: 100 });
    const b = baseIssue({ id: "b", priority: "focus", focusOrder: 0, updatedAt: 50 });
    const c = baseIssue({ id: "c", priority: "focus", focusOrder: 1, updatedAt: 200 });
    expect([a, b, c].sort(compareIssuesByPriority).map((i) => i.id)).toEqual(["b", "c", "a"]);
  });
});

describe("isIssueStalled", () => {
  const now = Date.now();
  const staleDays = 14;

  it("archived済みは対象外", () => {
    const issue = baseIssue({ archived: true, actionItems: [{ id: "1", text: "a", done: false }], updatedAt: now - 30 * 24 * 60 * 60 * 1000 });
    expect(isIssueStalled(issue, now, staleDays)).toBe(false);
  });

  it("子Issue（parentIdあり）は対象外", () => {
    const issue = baseIssue({ parentId: "p1", actionItems: [{ id: "1", text: "a", done: false }], updatedAt: now - 30 * 24 * 60 * 60 * 1000 });
    expect(isIssueStalled(issue, now, staleDays)).toBe(false);
  });

  it("着手前（charter未整理かつAction Item無し）は対象外", () => {
    const issue = baseIssue({ updatedAt: now - 30 * 24 * 60 * 60 * 1000 });
    expect(isIssueStalled(issue, now, staleDays)).toBe(false);
  });

  it("着手済みで閾値を超えていればtrue", () => {
    const issue = baseIssue({
      actionItems: [{ id: "1", text: "a", done: false }],
      updatedAt: now - 30 * 24 * 60 * 60 * 1000,
    });
    expect(isIssueStalled(issue, now, staleDays)).toBe(true);
  });

  it("閾値以内ならfalse", () => {
    const issue = baseIssue({
      actionItems: [{ id: "1", text: "a", done: false }],
      updatedAt: now - 1 * 24 * 60 * 60 * 1000,
    });
    expect(isIssueStalled(issue, now, staleDays)).toBe(false);
  });
});

function baseEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "1",
    rawText: "text",
    tags: [],
    people: [],
    urgency: "mid",
    sentiment: "neutral",
    summary: "",
    createdAt: Date.now(),
    confirmed: true,
    ...overrides,
  };
}

describe("isJournalEntryResolved", () => {
  it("resolvedIssueIdもresolutionNoteも無ければ未対応", () => {
    expect(isJournalEntryResolved(baseEntry())).toBe(false);
  });

  it("resolvedIssueIdがあれば対応済み", () => {
    expect(isJournalEntryResolved(baseEntry({ resolvedIssueId: "issue-1" }))).toBe(true);
  });

  it("resolutionNoteがあれば対応済み", () => {
    expect(isJournalEntryResolved(baseEntry({ resolutionNote: "様子見に決めた" }))).toBe(true);
  });
});

describe("personVitalStatus", () => {
  it("件数が2未満なら評価不能", () => {
    expect(personVitalStatus({ positive: 1, negative: 0, neutral: 0 })).toBe("unknown");
    expect(personVitalStatus({ positive: 0, negative: 0, neutral: 0 })).toBe("unknown");
  });

  it("ネガティブがポジティブより多ければbad", () => {
    expect(personVitalStatus({ positive: 1, negative: 3, neutral: 0 })).toBe("bad");
  });

  it("同数（0より多い）ならwarn", () => {
    expect(personVitalStatus({ positive: 2, negative: 2, neutral: 0 })).toBe("warn");
  });

  it("ポジティブが優勢、またはネガティブが無ければgood", () => {
    expect(personVitalStatus({ positive: 3, negative: 1, neutral: 0 })).toBe("good");
    expect(personVitalStatus({ positive: 0, negative: 0, neutral: 3 })).toBe("good");
  });
});

describe("truncateForTitle", () => {
  it("上限以下ならそのまま返す", () => {
    expect(truncateForTitle("短いタイトル")).toBe("短いタイトル");
  });

  it("前後の空白は除去する", () => {
    expect(truncateForTitle("  タイトル  ")).toBe("タイトル");
  });

  it("上限を超えたら切り詰めて…を付ける（文の途中で切れたことをEMが分かるようにする）", () => {
    const long = "あ".repeat(80);
    const result = truncateForTitle(long, 60);
    expect(result).toBe(`${"あ".repeat(59)}…`);
    expect(result.length).toBe(60);
  });

  it("maxLengthを指定できる", () => {
    expect(truncateForTitle("あいうえおかきくけこ", 5)).toBe("あいうえ…");
  });
});

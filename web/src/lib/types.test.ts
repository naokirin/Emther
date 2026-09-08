import { describe, expect, it } from "vitest";
import {
  charterFilledCount,
  isIssueStalled,
  isJournalEntryResolved,
  isRunStale,
  issueProgress,
  normalizeTeamName,
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

  it("子Issueの完了（status:doneまたはarchived）も合算する", () => {
    const issue = baseIssue();
    const children = [baseIssue({ id: "c1", status: "done" }), baseIssue({ id: "c2", archived: true }), baseIssue({ id: "c3" })];
    expect(issueProgress(issue, children)).toEqual({ done: 2, total: 3 });
  });

  it("項目が無ければ0/0", () => {
    expect(issueProgress(baseIssue())).toEqual({ done: 0, total: 0 });
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

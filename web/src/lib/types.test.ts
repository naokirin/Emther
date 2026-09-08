import { describe, expect, it } from "vitest";
import {
  charterFilledCount,
  isJournalEntryResolved,
  isRunStale,
  normalizeTeamName,
  teamDisplayName,
  teamPathSegments,
  truncateForTitle,
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

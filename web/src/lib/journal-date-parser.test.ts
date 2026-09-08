import { describe, expect, it } from "vitest";
import {
  dateStringToNoonTimestamp,
  parseBulkJournalText,
  parseDateMarkerLine,
  timestampToDateInputValue,
} from "@/lib/journal-date-parser";

// 基準時刻: 2026-03-05(木) 12:00:00 ローカル時刻
const NOW = new Date(2026, 2, 5, 12, 0, 0, 0).getTime();

function noonOf(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

describe("parseDateMarkerLine", () => {
  it("空行はマーカーとして扱わない", () => {
    expect(parseDateMarkerLine("", NOW)).toBeUndefined();
    expect(parseDateMarkerLine("   ", NOW)).toBeUndefined();
  });

  it("「今日」「昨日」「一昨日」「おととい」を解決する", () => {
    expect(parseDateMarkerLine("今日", NOW)).toBe(noonOf(2026, 3, 5));
    expect(parseDateMarkerLine("昨日", NOW)).toBe(noonOf(2026, 3, 4));
    expect(parseDateMarkerLine("一昨日", NOW)).toBe(noonOf(2026, 3, 3));
    expect(parseDateMarkerLine("おととい", NOW)).toBe(noonOf(2026, 3, 3));
  });

  it("曜日は直近の過去（今日を含む）のその曜日を指す", () => {
    // NOWは木曜日
    expect(parseDateMarkerLine("木", NOW)).toBe(noonOf(2026, 3, 5)); // 今日そのもの
    expect(parseDateMarkerLine("木曜", NOW)).toBe(noonOf(2026, 3, 5));
    expect(parseDateMarkerLine("木曜日", NOW)).toBe(noonOf(2026, 3, 5));
    expect(parseDateMarkerLine("月", NOW)).toBe(noonOf(2026, 3, 2)); // 直近の月曜（3日前）
    expect(parseDateMarkerLine("金", NOW)).toBe(noonOf(2026, 2, 27)); // 直近の過去の金曜（翌日ではなく1週間前）
  });

  it("ISO形式(YYYY-MM-DD / YYYY/MM/DD)を解決する", () => {
    expect(parseDateMarkerLine("2026-01-15", NOW)).toBe(noonOf(2026, 1, 15));
    expect(parseDateMarkerLine("2026/01/15", NOW)).toBe(noonOf(2026, 1, 15));
  });

  it("桁あふれのISO日付(2/30等)は無効", () => {
    expect(parseDateMarkerLine("2026-02-30", NOW)).toBeUndefined();
  });

  it("M/D形式は年省略で今年扱いになる", () => {
    expect(parseDateMarkerLine("3/1", NOW)).toBe(noonOf(2026, 3, 1));
  });

  it("M/D形式が未来日になる場合は去年にフォールバックする", () => {
    // NOWは2026-03-05なので12/25は未来日 → 去年(2025)扱い
    expect(parseDateMarkerLine("12/25", NOW)).toBe(noonOf(2025, 12, 25));
  });

  it("M/D形式で1日先までは今年扱い（許容誤差）", () => {
    expect(parseDateMarkerLine("3/6", NOW)).toBe(noonOf(2026, 3, 6));
  });

  it("M月D日形式（「日」省略可）を解決する", () => {
    expect(parseDateMarkerLine("3月1日", NOW)).toBe(noonOf(2026, 3, 1));
    expect(parseDateMarkerLine("3月1", NOW)).toBe(noonOf(2026, 3, 1));
  });

  it("文中に日付らしき文字列があっても行全体が一致しなければマーカーにしない", () => {
    expect(parseDateMarkerLine("3/1に面談した", NOW)).toBeUndefined();
    expect(parseDateMarkerLine("今日は疲れた", NOW)).toBeUndefined();
  });

  it("前後の空白はtrimして判定する", () => {
    expect(parseDateMarkerLine("  今日  ", NOW)).toBe(noonOf(2026, 3, 5));
  });
});

describe("timestampToDateInputValue", () => {
  it("YYYY-MM-DD形式（ローカル時刻基準）に変換する", () => {
    expect(timestampToDateInputValue(noonOf(2026, 3, 5))).toBe("2026-03-05");
  });

  it("月日を2桁ゼロ埋めする", () => {
    expect(timestampToDateInputValue(noonOf(2026, 1, 9))).toBe("2026-01-09");
  });
});

describe("dateStringToNoonTimestamp", () => {
  it("YYYY-MM-DD文字列を正午のタイムスタンプに変換する", () => {
    expect(dateStringToNoonTimestamp("2026-03-05")).toBe(noonOf(2026, 3, 5));
  });

  it("不正な形式はundefinedを返す", () => {
    expect(dateStringToNoonTimestamp("2026/03/05")).toBeUndefined();
    expect(dateStringToNoonTimestamp("not-a-date")).toBeUndefined();
  });

  it("桁あふれの日付はundefinedを返す", () => {
    expect(dateStringToNoonTimestamp("2026-02-30")).toBeUndefined();
  });
});

describe("parseBulkJournalText", () => {
  it("日付マーカーが無ければ全行が今日の日付になる", () => {
    const result = parseBulkJournalText("1on1でAさんと話した\nBさんのPRをレビューした", NOW);
    expect(result).toEqual([
      { text: "1on1でAさんと話した", occurredAt: noonOf(2026, 3, 5) },
      { text: "BさんのPRをレビューした", occurredAt: noonOf(2026, 3, 5) },
    ]);
  });

  it("日付マーカー行はそれ以降の行の日付を更新し、マーカー自身は結果に含まれない", () => {
    const text = ["3/1", "Aさんと1on1", "3/3", "Bさんが休んだ", "Cさんが復帰した"].join("\n");
    const result = parseBulkJournalText(text, NOW);
    expect(result).toEqual([
      { text: "Aさんと1on1", occurredAt: noonOf(2026, 3, 1) },
      { text: "Bさんが休んだ", occurredAt: noonOf(2026, 3, 3) },
      { text: "Cさんが復帰した", occurredAt: noonOf(2026, 3, 3) },
    ]);
  });

  it("日付マーカーが無い状態が続けば今日の日付を引き継ぐ", () => {
    const text = ["昨日", "Aさんと話した", "Bさんと話した"].join("\n");
    const result = parseBulkJournalText(text, NOW);
    expect(result.every((r) => r.occurredAt === noonOf(2026, 3, 4))).toBe(true);
  });

  it("空行は無視する", () => {
    const text = ["Aさんと話した", "", "  ", "Bさんと話した"].join("\n");
    const result = parseBulkJournalText(text, NOW);
    expect(result).toHaveLength(2);
  });

  it("maxLinesを超える行は切り捨てる", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `出来事${i}`);
    const result = parseBulkJournalText(lines.join("\n"), NOW, 3);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.text)).toEqual(["出来事0", "出来事1", "出来事2"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  isJournalEntryResolved,
  isSuggestionReviewOverdue,
  journalResolutionLabel,
  suggestionMatchesKeyword,
  isRunStale,
  normalizeTeamName,
  personVitalStatus,
  teamDisplayName,
  teamPathSegments,
  truncateForTitle,
  suggestionTitleFromConclusion,
  type JournalEntry,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

// ユーザー要望「後回しにする場合でも『いつまでには確認したい』という期日を入力したい」対応。
describe("isSuggestionReviewOverdue", () => {
  it("確認期日が過ぎており、未確認/確認保留/確認中なら期日超過とみなす", () => {
    const now = 1000 * DAY_MS;
    expect(isSuggestionReviewOverdue({ reviewStatus: "deferred", reviewDueAt: now - DAY_MS }, now)).toBe(true);
    expect(isSuggestionReviewOverdue({ reviewStatus: "in_review", reviewDueAt: now - DAY_MS }, now)).toBe(true);
  });

  it("期日が未来、または未設定なら期日超過ではない", () => {
    const now = 1000 * DAY_MS;
    expect(isSuggestionReviewOverdue({ reviewStatus: "deferred", reviewDueAt: now + DAY_MS }, now)).toBe(false);
    expect(isSuggestionReviewOverdue({ reviewStatus: "deferred" }, now)).toBe(false);
  });

  it("確認済み(done)またはアーカイブ済みなら、期日を過ぎていても期日超過扱いにしない", () => {
    const now = 1000 * DAY_MS;
    expect(isSuggestionReviewOverdue({ reviewStatus: "done", reviewDueAt: now - DAY_MS }, now)).toBe(false);
    expect(isSuggestionReviewOverdue({ reviewStatus: "deferred", reviewDueAt: now - DAY_MS, archivedAt: now - DAY_MS }, now)).toBe(
      false,
    );
  });
});

// ユーザー要望「提案の一覧でキーワード検索できるようにしてください」対応。
describe("suggestionMatchesKeyword", () => {
  it("空文字のクエリは常にマッチする", () => {
    expect(suggestionMatchesKeyword({ title: "タイトル", memos: [] }, "")).toBe(true);
    expect(suggestionMatchesKeyword({ title: "タイトル", memos: [] }, "   ")).toBe(true);
  });

  it("タイトルに部分一致すればマッチする", () => {
    expect(suggestionMatchesKeyword({ title: "リファクタリングの提案", memos: [] }, "リファクタ")).toBe(true);
    expect(suggestionMatchesKeyword({ title: "リファクタリングの提案", memos: [] }, "存在しない語")).toBe(false);
  });

  it("大小文字を区別せずマッチする", () => {
    expect(suggestionMatchesKeyword({ title: "APIのRefactor", memos: [] }, "refactor")).toBe(true);
  });

  it("メモにマッチする", () => {
    const s = { title: "タイトル", memos: [{ id: "1", text: "様子見にした", createdAt: 0 }] };
    expect(suggestionMatchesKeyword(s, "様子見")).toBe(true);
  });

  it("詳細（結論・根拠・ロジック・アドバイス）にマッチする", () => {
    const detail = {
      conclusion: "結論のテキスト",
      facts: ["根拠1", "根拠2"],
      logic: "ロジックのテキスト",
      advice: "アドバイスのテキスト",
      updatedAt: 0,
    };
    expect(suggestionMatchesKeyword({ title: "タイトル", memos: [], detail }, "結論のテキスト")).toBe(true);
    expect(suggestionMatchesKeyword({ title: "タイトル", memos: [], detail }, "根拠2")).toBe(true);
    expect(suggestionMatchesKeyword({ title: "タイトル", memos: [], detail }, "ロジックのテキスト")).toBe(true);
    expect(suggestionMatchesKeyword({ title: "タイトル", memos: [], detail }, "アドバイスのテキスト")).toBe(true);
  });

  it("detailが無い、advice未設定でもエラーにならない", () => {
    const detail = { conclusion: "結論", facts: [], logic: "ロジック", updatedAt: 0 };
    expect(suggestionMatchesKeyword({ title: "タイトル", memos: [] }, "結論")).toBe(false);
    expect(suggestionMatchesKeyword({ title: "タイトル", memos: [], detail }, "結論")).toBe(true);
  });
});

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


function baseEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "1",
    rawText: "text",
    tags: [],
    people: [],
    teamIds: [],
    urgency: "mid",
    sentiment: "neutral",
    summary: "",
    createdAt: Date.now(),
    confirmed: true,
    ...overrides,
  };
}

describe("isJournalEntryResolved", () => {
  it("resolvedSuggestionIdもresolutionNoteも無ければ未対応", () => {
    expect(isJournalEntryResolved(baseEntry())).toBe(false);
  });

  it("resolvedSuggestionIdがあれば対応済み", () => {
    expect(isJournalEntryResolved(baseEntry({ resolvedSuggestionId: "suggestion-1" }))).toBe(true);
  });

  it("resolutionNoteがあれば対応済み", () => {
    expect(isJournalEntryResolved(baseEntry({ resolutionNote: "様子見に決めた" }))).toBe(true);
  });
});

describe("journalResolutionLabel", () => {
  it("提案化済みは対応済み/提案化済み", () => {
    expect(journalResolutionLabel(baseEntry({ resolvedSuggestionId: "suggestion-1" }))).toBe("対応済み/提案化済み");
  });

  it("解決メモだけなら対応済み", () => {
    expect(journalResolutionLabel(baseEntry({ resolutionNote: "様子見" }))).toBe("対応済み");
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
    const long = "あ".repeat(100);
    const result = truncateForTitle(long, 80);
    expect(result).toBe(`${"あ".repeat(79)}…`);
    expect(result.length).toBe(80);
  });

  it("maxLengthを指定できる", () => {
    expect(truncateForTitle("あいうえおかきくけこ", 5)).toBe("あいうえ…");
  });

  it("句点付近で切れれば…を付けない", () => {
    const text = `${"あ".repeat(50)}。${"い".repeat(50)}`;
    expect(truncateForTitle(text, 60)).toBe(`${"あ".repeat(50)}。`);
  });

  it("読点付近で切れるときは…を付ける", () => {
    const text = `${"あ".repeat(50)}、${"い".repeat(50)}`;
    expect(truncateForTitle(text, 60)).toBe(`${"あ".repeat(50)}、…`);
  });
});

describe("suggestionTitleFromConclusion", () => {
  it("提案化メタの接尾辞を除く", () => {
    expect(suggestionTitleFromConclusion("五木さんの目標設定の悩みをIssue化して追跡すべきと判断します")).toBe(
      "五木さんの目標設定の悩み",
    );
  });

  it("短い結論はそのまま（末尾句点だけ除去）", () => {
    expect(suggestionTitleFromConclusion("障害対応の属人化を解消する。")).toBe("障害対応の属人化を解消する");
  });
});

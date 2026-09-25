import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUGGESTION_EXPORT_COLUMN_IDS,
  SUGGESTION_EXPORT_COLUMNS,
  buildExportChatTurns,
  buildSuggestionUrl,
  enableAllExportColumns,
  escapeCsvCell,
  formatSuggestionMarkdown,
  formatSuggestionsCsv,
  formatSuggestionsMarkdownBundle,
  formatSuggestionsMarkdownTable,
  formatSuggestionsTsv,
  formatMemoForExport,
  moveExportColumn,
  normalizeExportColumnIds,
  reorderExportColumn,
  resolveExportColumns,
  sanitizeExportCell,
  toggleExportColumn,
} from "./suggestion-export";
import type { Suggestion } from "./types";

function sug(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: "sug-1",
    title: "提案A",
    reviewStatus: "in_review",
    confirmPriority: "focus",
    memos: [{ id: "m1", text: "メモ1", createdAt: 1 }],
    detail: {
      conclusion: "結論です",
      facts: ["事実1", "事実2"],
      logic: "ロジック本文",
      advice: "こう進める",
      expansions: ["別の見方"],
      challenges: ["前提は正しいか"],
      explorations: [],
      updatedAt: 1,
    },
    themeId: "th-1",
    teamId: "tm-1",
    reviewDueAt: Date.UTC(2026, 8, 22, 3, 0, 0),
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("formatMemoForExport", () => {
  it("source に応じて接頭辞を付ける", () => {
    expect(formatMemoForExport({ text: "本文" })).toBe("本文");
    expect(formatMemoForExport({ text: "本文", source: "user" })).toBe("〔自分〕本文");
    expect(formatMemoForExport({ text: "本文", source: "agent" })).toBe("〔AI〕本文");
  });
});

describe("sanitizeExportCell", () => {
  it("タブと改行を空白にする", () => {
    expect(sanitizeExportCell("a\tb\nc\r\nd")).toBe("a b c d");
  });
});

describe("buildSuggestionUrl", () => {
  it("origin があれば絶対 URL、無ければパスのみ", () => {
    expect(buildSuggestionUrl("sug-1")).toBe("/suggestions/sug-1");
    expect(buildSuggestionUrl("sug-1", "http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000/suggestions/sug-1");
  });
});

describe("formatSuggestionMarkdown", () => {
  it("詳細・メモ・メタ・URL を含む Markdown を返す", () => {
    const md = formatSuggestionMarkdown(sug(), {
      themeTitleById: { "th-1": "テーマX" },
      teamNameById: { "tm-1": "チームY" },
      appOrigin: "http://127.0.0.1:3000",
    });
    expect(md).toContain("# 提案A\n");
    expect(md).toContain("## 結論\n結論です\n");
    expect(md).toContain("- 事実1");
    expect(md).toContain("## 判断ロジック\nロジック本文\n");
    expect(md).toContain("## 視点の広がり（Expand）");
    expect(md).toContain("## 前提への問い（Challenge）");
    expect(md).toContain("## 進め方のアドバイス\nこう進める\n");
    expect(md).toContain("- メモ1");
    expect(md).toContain("Theme: テーマX");
    expect(md).toContain("Team: チームY");
    expect(md).toContain("Confirm: 今すぐ確認 / 確認中");
    expect(md).toContain("Emther ID: sug-1");
    expect(md).toContain("Emther URL: http://127.0.0.1:3000/suggestions/sug-1");
  });

  it("explorationsがあれば探索セクションを出す", () => {
    const md = formatSuggestionMarkdown(
      sug({
        detail: {
          conclusion: "結論です",
          facts: [],
          logic: "ロジック",
          explorations: [
            {
              kind: "blind_spot",
              observation: "User Valueの観測が少ない",
              relevance: "Goalと関連",
              confirmationQuestion: "変化はありましたか？",
            },
          ],
          updatedAt: 1,
        },
      }),
    );
    expect(md).toContain("## 探索（Explore）");
    expect(md).toContain("[blind_spot] User Valueの観測が少ない");
    expect(md).toContain("確認質問: 変化はありましたか？");
  });

  it("メモの source を Markdown に反映する", () => {
    const md = formatSuggestionMarkdown(
      sug({
        memos: [
          { id: "a", text: "手入力", createdAt: 1, source: "user" },
          { id: "b", text: "AI追記", createdAt: 2, source: "agent" },
        ],
      }),
    );
    expect(md).toContain("- 〔自分〕手入力");
    expect(md).toContain("- 〔AI〕AI追記");
  });

  it("detail が無いときは結論セクションを出さない", () => {
    const md = formatSuggestionMarkdown(sug({ detail: undefined, memos: [] }));
    expect(md).not.toContain("## 結論");
    expect(md).toContain("# 提案A\n");
    expect(md).toContain("Emther ID: sug-1");
  });

  it("agentSource があれば末尾に AI 出力の参照を付ける", () => {
    const md = formatSuggestionMarkdown(sug(), {
      agentSource: {
        heading: "判断・提案（Agent）",
        agentName: "Lead Agent",
        proposal: {
          conclusion: "AI結論",
          facts: ["AI事実"],
          logic: "AIロジック",
          advice: "AI助言",
          expansions: ["AI Expand"],
          challenges: ["AI Challenge"],
          explorations: [],
          rejectedAlternatives: [{ option: "案B", reason: "効果が薄い" }],
        },
        log: [
          { channel: "meta", text: "タスクを受理: 壁打ち開始" },
          { channel: "agent", text: "まず状況を整理します\n```proposal\n{}\n```" },
          { channel: "meta", text: "EMからの入力: もっと詳しく" },
          { channel: "agent", text: "詳細はこうです" },
        ],
      },
    });
    expect(md).toContain("## 参照: AI出力（判断・提案（Agent））");
    expect(md).toContain("Agent: Lead Agent");
    expect(md).toContain("### 判断・提案");
    expect(md).toContain("#### 結論\nAI結論");
    expect(md).toContain("#### 判断ロジック\nAIロジック");
    expect(md).toContain("#### 棄却した代替案");
    expect(md).toContain("### 壁打ち");
    expect(md).toContain("**EM:**\n壁打ち開始");
    expect(md).toContain("**Lead Agent:**\nまず状況を整理します");
    expect(md).not.toContain("```proposal");
    expect(md).toContain("**Lead Agent:**\n詳細はこうです");
  });
});

describe("buildExportChatTurns", () => {
  it("構造化ブロックを除き user/ai に分ける", () => {
    const turns = buildExportChatTurns([
      { channel: "agent", text: "本文\n```yield\nx\n```" },
      { channel: "meta", text: "EMからの入力: 返信" },
    ]);
    expect(turns).toEqual([
      { kind: "ai", text: "本文" },
      { kind: "user", text: "返信" },
    ]);
  });
});

describe("formatSuggestionsTsv / MarkdownTable", () => {
  it("既定列で TSV を出す", () => {
    const tsv = formatSuggestionsTsv([sug()], DEFAULT_SUGGESTION_EXPORT_COLUMN_IDS, {
      themeTitleById: { "th-1": "テーマX" },
      teamNameById: { "tm-1": "チームY" },
    });
    const lines = tsv.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "タイトル\t結論\t根拠\t判断ロジック\t進め方のアドバイス\tメモ\tテーマ\tチーム\t確認優先度\t確認状態\t確認期日\tEmther ID\tEmther URL",
    );
    expect(lines[1]).toContain("提案A\t結論です\t");
    expect(lines[1]).toContain("テーマX\tチームY\t");
    expect(lines[1]).toContain("今すぐ確認");
    expect(lines[1]).toContain("sug-1");
  });

  it("url 列は appOrigin 付きで出す", () => {
    const tsv = formatSuggestionsTsv([sug()], ["id", "url"], {
      appOrigin: "http://localhost:5173",
    });
    expect(tsv).toContain("Emther ID\tEmther URL");
    expect(tsv).toContain("sug-1\thttp://localhost:5173/suggestions/sug-1");
  });

  it("根拠・判断ロジック・メモ・AI列を出せる", () => {
    const tsv = formatSuggestionsTsv(
      [sug()],
      ["facts", "logic", "advice", "memos", "aiConclusion", "aiFacts", "aiLogic", "aiAdvice", "aiChat"],
      {
        agentSourceBySuggestionId: {
          "sug-1": {
            agentName: "Lead Agent",
            proposal: {
              conclusion: "AI結論",
              facts: ["AI事実1", "AI事実2"],
              logic: "AIロジック",
              advice: "AI助言",
              expansions: [],
              challenges: [],
              explorations: [],
              rejectedAlternatives: [],
            },
            log: [
              { channel: "meta", text: "EMからの入力: 質問" },
              { channel: "agent", text: "回答です" },
            ],
          },
        },
      },
    );
    const header = tsv.trimEnd().split("\n")[0];
    const row = tsv.trimEnd().split("\n")[1]!;
    expect(header).toBe(
      "根拠\t判断ロジック\t進め方のアドバイス\tメモ\tAI結論\tAI根拠\tAI判断ロジック\tAI進め方のアドバイス\tAI壁打ち",
    );
    expect(row).toContain("事実1 / 事実2");
    expect(row).toContain("ロジック本文");
    expect(row).toContain("こう進める");
    expect(row).toContain("メモ1");
    expect(row).toContain("AI結論");
    expect(row).toContain("AI事実1 / AI事実2");
    expect(row).toContain("AIロジック");
    expect(row).toContain("AI助言");
    expect(row).toContain("EM: 質問 | Lead Agent: 回答です");
  });

  it("CSV はカンマ・改行をクォートする", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    const csv = formatSuggestionsCsv(
      [sug({ title: "A,B", detail: { conclusion: "行1\n行2", facts: [], logic: "x", updatedAt: 1 } })],
      ["title", "conclusion"],
      {},
    );
    expect(csv).toContain("タイトル,結論");
    expect(csv).toContain('"A,B"');
    expect(csv).toContain('"行1\n行2"');
  });

  it("Markdown bundle は複数件を --- でつなぐ", () => {
    const md = formatSuggestionsMarkdownBundle(
      [sug({ id: "a", title: "一件目" }), sug({ id: "b", title: "二件目", memos: [] })],
      { appOrigin: "http://127.0.0.1:3000" },
    );
    expect(md).toContain("# 一件目");
    expect(md).toContain("# 二件目");
    expect(md).toContain("\n\n---\n\n");
    expect(md).toContain("Emther URL: http://127.0.0.1:3000/suggestions/a");
  });

  it("Markdown 表を出す", () => {
    const md = formatSuggestionsMarkdownTable([sug()], ["title", "id"], {});
    expect(md).toContain("| タイトル | Emther ID |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 提案A | sug-1 |");
  });

  it("セル内の | をエスケープする", () => {
    const md = formatSuggestionsMarkdownTable([sug({ title: "A|B" })], ["title"], {});
    expect(md).toContain("| A\\|B |");
  });
});

describe("column helpers (β)", () => {
  it("normalize は未知・重複を落とし空なら既定", () => {
    expect(normalizeExportColumnIds(["title", "title", "nope", "id"])).toEqual(["title", "id"]);
    expect(normalizeExportColumnIds([])).toEqual(DEFAULT_SUGGESTION_EXPORT_COLUMN_IDS);
  });

  it("resolveExportColumns は有効順を保つ", () => {
    expect(resolveExportColumns(["id", "title"]).map((c) => c.id)).toEqual(["id", "title"]);
  });

  it("move / reorder / toggle が並びとオンオフを変える", () => {
    expect(moveExportColumn(["title", "id"], "id", "up")).toEqual(["id", "title"]);
    expect(reorderExportColumn(["title", "conclusion", "theme", "id"], "id", 1)).toEqual([
      "title",
      "id",
      "conclusion",
      "theme",
    ]);
    expect(reorderExportColumn(["title", "id"], "title", 0)).toEqual(["title", "id"]);
    expect(reorderExportColumn(["title", "id"], "missing" as "title", 0)).toEqual(["title", "id"]);
    expect(toggleExportColumn(["title", "id"], "theme", true)).toEqual(["title", "id", "theme"]);
    expect(toggleExportColumn(["title"], "title", false)).toEqual(["title"]);
  });

  it("enableAllExportColumns は既存順を保ちつつ残りをカタログ順で足す", () => {
    const all = enableAllExportColumns(["id", "title"]);
    expect(all[0]).toBe("id");
    expect(all[1]).toBe("title");
    expect(all).toHaveLength(SUGGESTION_EXPORT_COLUMNS.length);
    expect(new Set(all).size).toBe(SUGGESTION_EXPORT_COLUMNS.length);
    expect(enableAllExportColumns(all)).toEqual(all);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

let mockChatResponse = JSON.stringify({ findings: [], people: [] });
vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => mockChatResponse),
  extractFirstJsonObject: (text: string) => {
    const start = text.indexOf("{");
    if (start === -1) return undefined;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return undefined;
  },
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  mockChatResponse = JSON.stringify({ findings: [], people: [] });
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

const INCIDENT_SAMPLE = `
個人情報の一部漏洩を伴うセキュリティインシデントにおける緊急マネージャMTG議事録抜粋

高井さん: 一部Azure上のストレージへの不審なアクセスを確認している。個人情報が一部含まれたデータも保管されているため、緊急での対応方針の決定と対応実施を進めたい。
大岩さん: 現状の外部からのアクセスについて、抑止できている状況か確認したい。
東郷さん: SREチームでAzureに関して、ただとしさんのアカウントが不正に利用されて操作されたことは確認できている。自分とUMの田中さん以外のアクセスを遮断している。APIキーのような認証系もすべて閉じている状況です。
友瀬さん: 一旦、ただとしさんのアカウントが不正利用されたことはわかっている。
トニーさん、佐伯さんにも入ってもらう。
`.trim();

describe("detectSensitiveByRules", () => {
  it("メール・電話・APIキーっぽい文字列を検出する", async () => {
    const { detectSensitiveByRules } = await import("@/lib/mask-check");
    const findings = detectSensitiveByRules(
      "連絡先は user@example.com / 090-1234-5678。鍵は sk-abcdefghijklmnopqrstuvwxyz0123456789",
    );
    const cats = findings.map((f) => f.category);
    expect(cats).toContain("email");
    expect(cats).toContain("phone");
    expect(cats).toContain("api_key_like");
    expect(findings.every((f) => f.source === "rule" && f.match && f.start !== undefined)).toBe(true);
  });

  it("URLクエリの token を url_secret として検出する", async () => {
    const { detectSensitiveByRules } = await import("@/lib/mask-check");
    const findings = detectSensitiveByRules("https://example.com/cb?token=abc123&x=1");
    expect(findings.some((f) => f.category === "url_secret")).toBe(true);
  });

  it("実値が無くても個人情報・APIキー言及をキーワードで検出し match を持つ", async () => {
    const { detectSensitiveByRules } = await import("@/lib/mask-check");
    const findings = detectSensitiveByRules(INCIDENT_SAMPLE);
    const cats = new Set(findings.map((f) => f.category));
    expect(cats.has("other_sensitive")).toBe(true);
    expect(cats.has("credential_mention")).toBe(true);
    // CORE 核フレーズ（TUNING キーワードは縮小済み）
    expect(findings.some((f) => f.match.includes("個人情報"))).toBe(true);
    expect(findings.some((f) => /APIキー|認証情報/i.test(f.match))).toBe(true);
  });

  it("企業名・住所・生年月日・IDを構造パターンで検出する", async () => {
    const { detectSensitiveByRules } = await import("@/lib/mask-check");
    const text =
      "株式会社ブルースターの担当。住所は東京都新宿区西新宿2丁目8番1号。" +
      "生年月日を確認したところ1989年6月12日。ログインID `mf-takahashi-2048` と顧客番号はC-493821。";
    const findings = detectSensitiveByRules(text);
    expect(findings.some((f) => f.category === "organization" && f.match.includes("株式会社ブルースター"))).toBe(
      true,
    );
    expect(findings.some((f) => f.category === "address" && f.match.includes("東京都新宿区"))).toBe(true);
    expect(findings.some((f) => f.category === "date_of_birth" && f.match.includes("1989年6月12日"))).toBe(
      true,
    );
    expect(findings.some((f) => f.category === "identifier" && f.match.includes("mf-takahashi-2048"))).toBe(
      true,
    );
    expect(findings.some((f) => f.category === "identifier" && f.match.includes("C-493821"))).toBe(true);
  });
});

describe("detectNameCandidates", () => {
  it("未登録の敬称付き人名を列挙し、登録済みは除外する", async () => {
    const pd = await import("@/lib/people-directory");
    pd.registerName("田中さん");
    const { detectNameCandidatesAsync } = await import("@/lib/mask-check");
    const names = await detectNameCandidatesAsync(INCIDENT_SAMPLE);
    expect(names).toContain("高井さん");
    expect(names).toContain("大岩さん");
    expect(names).toContain("東郷さん");
    expect(names).toContain("ただとしさん");
    expect(names).toContain("友瀬さん");
    expect(names).toContain("トニーさん");
    expect(names).toContain("佐伯さん");
    expect(names).not.toContain("田中さん");
    // 敬称ありとなしの二重掲載なし
    expect(names).not.toContain("高井");
    expect(names).not.toContain("トニー");
    // 助詞食い込みなし
    expect(names.some((n) => n.includes("自分と") || n.includes("UM"))).toBe(false);
  });

  it("敬称なしは話者ラベルと形態素人名POSから検出する", async () => {
    const { detectNameCandidatesAsync } = await import("@/lib/mask-check");
    const names = await detectNameCandidatesAsync("高井: インシデント対応。トニーにも入ってもらう。");
    expect(names).toContain("高井");
    expect(names).toContain("トニー");
    expect(names).not.toContain("インシデント");
  });

  it("カタカナ人名は敬称付きなら検出する", async () => {
    const { detectNameCandidates } = await import("@/lib/mask-check");
    const names = detectNameCandidates("トニーさんにも入ってもらう。");
    expect(names).toContain("トニーさん");
  });

  it("佐々木花子さんを欠かさず検出し、仕様・同様・客様は人名にしない", async () => {
    const { detectNameCandidatesAsync } = await import("@/lib/mask-check");
    const names = await detectNameCandidatesAsync(
      "佐々木花子さんと打ち合わせ。お客様の仕様と同様に進める。",
    );
    expect(names).toContain("佐々木花子さん");
    expect(names).not.toContain("々木花子さん");
    expect(names).not.toContain("仕様");
    expect(names).not.toContain("同様");
    expect(names).not.toContain("客様");
  });

  it("形態素で敬称なしの姓（山本・伊藤・渡辺）を検出し仕様は拾わない", async () => {
    const { detectNameCandidatesAsync } = await import("@/lib/mask-check");
    const names = await detectNameCandidatesAsync(
      "田中さんが担当。同様に、山本、伊藤、渡辺という名前もテストケース。仕様について。",
    );
    expect(names).toContain("田中さん");
    expect(names).toContain("山本");
    expect(names).toContain("伊藤");
    expect(names).toContain("渡辺");
    expect(names).not.toContain("仕様");
    expect(names).not.toContain("同様");
  });

  it("トニーさんがあるとき一覧は敬称ありのみ（bareはハイライト用に展開）", async () => {
    const { detectNameCandidates, expandNamesForHighlight } = await import("@/lib/mask-check");
    const names = detectNameCandidates("トニーさんに頼む");
    expect(names).toContain("トニーさん");
    expect(names).not.toContain("トニー");
    expect(expandNamesForHighlight(names)).toContain("トニー");
  });

  it("短い敬称名が長い敬称名に含まれるとき長い方だけ残す", async () => {
    const { dedupeNamesPreferHonorific } = await import("@/lib/mask-check");
    expect(dedupeNamesPreferHonorific(["中村さん", "中村一郎さん", "鈴木さん"])).toEqual([
      "中村一郎さん",
      "鈴木さん",
    ]);
  });
});

describe("filterNameCandidatesWithLocalAi", () => {
  it("一般語を落として人名だけ残す", async () => {
    mockChatResponse = JSON.stringify({ people: ["鈴木さん", "山田太郎さん"] });
    const { filterNameCandidatesWithLocalAi } = await import("@/lib/mask-check");
    const result = await filterNameCandidatesWithLocalAi([
      "鈴木さん",
      "テスト",
      "ログイン",
      "山田太郎さん",
      "テーブル",
    ]);
    expect(result.filtered).toBe(true);
    expect(result.people).toEqual(["鈴木さん", "山田太郎さん"]);
  });

  it("AIが空を返したら敬称付きだけフォールバック", async () => {
    mockChatResponse = JSON.stringify({ people: [] });
    const { filterNameCandidatesWithLocalAi } = await import("@/lib/mask-check");
    const result = await filterNameCandidatesWithLocalAi(["鈴木さん", "テスト"]);
    expect(result.people).toEqual(["鈴木さん"]);
  });
});

describe("buildTextHighlights", () => {
  it("機微 match と人名をハイライト区間にする", async () => {
    const {
      detectSensitiveByRules,
      detectNameCandidatesAsync,
      buildTextHighlights,
      expandNamesForHighlight,
    } = await import("@/lib/mask-check");
    const text = "トニーさんがAPIキーを閉じた";
    const findings = detectSensitiveByRules(text);
    const names = await detectNameCandidatesAsync(text);
    const highlights = buildTextHighlights(text, findings, expandNamesForHighlight(names));
    expect(highlights.some((h) => h.kind === "credential_mention" && h.match.includes("APIキー"))).toBe(
      true,
    );
    expect(highlights.some((h) => h.kind === "name_candidate" && (h.match === "トニー" || h.match === "トニーさん"))).toBe(
      true,
    );
  });
});

describe("runMaskCheckQuick", () => {
  it("登録済み人名をマスクし、未登録人名と機微キーワードも即時返す", async () => {
    const pd = await import("@/lib/people-directory");
    pd.registerName("田中さん");
    const before = pd.listPeople().length;

    const { runMaskCheckQuick } = await import("@/lib/mask-check");
    const result = await runMaskCheckQuick(INCIDENT_SAMPLE);

    expect(result.maskedText).toContain("PERSON_");
    expect(result.maskedText).not.toContain("田中さん");
    expect(result.nameReplacements.some((r) => r.from.includes("田中"))).toBe(true);
    expect(result.unregisteredNameCandidates.length).toBeGreaterThan(3);
    expect(result.sensitiveFindings.length).toBeGreaterThan(0);
    expect(result.highlights.length).toBeGreaterThan(0);
    expect(result.sourceText.length).toBeGreaterThan(0);
    expect(pd.listPeople().length).toBe(before);
  });

  it("メール実値も従来どおり検出する", async () => {
    const { runMaskCheckQuick } = await import("@/lib/mask-check");
    const result = await runMaskCheckQuick("花子さんと user@example.com で話した");
    expect(result.sensitiveFindings.some((f) => f.category === "email")).toBe(true);
  });
});

describe("runMaskCheckAi", () => {
  it("ローカルAIの findings / people を返し、人名を登録しない", async () => {
    mockChatResponse = JSON.stringify({
      findings: [{ category: "health", excerpt: "体調不良で休み", match: "体調不良" }],
      people: ["次郎さん"],
    });
    const pd = await import("@/lib/people-directory");
    const before = pd.listPeople().length;

    const { runMaskCheckAi } = await import("@/lib/mask-check");
    const result = await runMaskCheckAi("次郎さんが体調不良で休み");

    expect(result.sensitiveFindings[0]?.category).toBe("health");
    expect(result.sensitiveFindings[0]?.match).toBe("体調不良");
    expect(result.unregisteredNameCandidates).toContain("次郎さん");
    expect(result.aiWeak).toBe(false);
    expect(pd.listPeople().length).toBe(before);
    expect(pd.getPersonId("次郎さん")).toBeUndefined();
  });

  it("AIが空でもルール人名は返し、aiWeakになる", async () => {
    mockChatResponse = JSON.stringify({ findings: [], people: [] });
    const { runMaskCheckAi } = await import("@/lib/mask-check");
    const result = await runMaskCheckAi("高井さんがAPIキーについて話した");
    expect(result.aiWeak).toBe(true);
    expect(result.unregisteredNameCandidates).toContain("高井さん");
    expect(result.aiScopeNote).toContain("ルール結果");
  });

  it("登録済みの人名は未登録候補に出さない", async () => {
    mockChatResponse = JSON.stringify({
      findings: [],
      people: ["花子さん"],
    });
    const pd = await import("@/lib/people-directory");
    pd.registerName("花子さん");

    const { runMaskCheckAi } = await import("@/lib/mask-check");
    const result = await runMaskCheckAi("花子さんの件");
    expect(result.unregisteredNameCandidates).toEqual([]);
  });
});

describe("previewNameMask", () => {
  it("同一表記の出現回数を数える", async () => {
    const pd = await import("@/lib/people-directory");
    const id = pd.registerName("太郎さん");
    const preview = pd.previewNameMask("太郎さんと太郎さんが同席");
    expect(preview.maskedText).toBe(`${id}と${id}が同席`);
    expect(preview.replacements).toEqual([{ from: "太郎さん", to: id, count: 2 }]);
  });
});

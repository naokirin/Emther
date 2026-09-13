/**
 * 個人・機密情報チェックの語彙・ルール定義。
 *
 * - CORE: ドメイン横断で妥当な短い核
 * - TUNING: 検証サンプル由来の積み上げ（過適合の温床になりうるため分離）
 *
 * このコミット時点では TUNING は空。続くコミットでサンプル由来を載せる。
 */
import type { SensitiveCategory } from "@/lib/mask-check-types";

export type KeywordRule = { category: SensitiveCategory; phrases: string[] };

export const CORE_KEYWORD_RULES: KeywordRule[] = [
  {
    category: "credential_mention",
    phrases: ["APIキー", "パスワード", "認証情報", "アクセスキー", "シークレット", "トークン"],
  },
  {
    category: "other_sensitive",
    phrases: ["個人情報", "機密情報", "機微情報", "情報漏洩", "漏洩"],
  },
  {
    category: "health",
    phrases: ["メンタル", "休職", "体調不良", "診断書"],
  },
  {
    category: "compensation",
    phrases: ["年収", "給与", "報酬", "査定"],
  },
  {
    category: "customer_or_contract",
    phrases: ["契約金額", "顧客情報", "NDA", "秘密保持"],
  },
];

export const CORE_KATAKANA_STOPWORDS: readonly string[] = [
  "システム",
  "アカウント",
  "アクセス",
  "サービス",
  "チーム",
  "データ",
  "パスワード",
  "トークン",
  "スケジュール",
  "プロジェクト",
  "セキュリティ",
  "ユーザ",
  "ユーザー",
];

export const CORE_HIRAGANA_STOPWORDS: readonly string[] = [
  "こちら",
  "そちら",
  "すべて",
  "わたし",
  "あなた",
  "ために",
  "ように",
  "について",
  "として",
  "という",
];

export const CORE_SPEAKER_KANJI_STOPWORDS: readonly string[] = [
  "対応",
  "調査",
  "現状",
  "確認",
  "連絡",
  "情報",
  "決定",
  "実施",
  "担当",
];

export const CORE_HIRAGANA_NAME_LOOKAHEAD = "";

/** サンプル由来。コアコミットでは空。 */
export const TUNING_KEYWORD_RULES: KeywordRule[] = [];
export const TUNING_KATAKANA_STOPWORDS: readonly string[] = [];
export const TUNING_HIRAGANA_STOPWORDS: readonly string[] = [];
export const TUNING_SPEAKER_KANJI_STOPWORDS: readonly string[] = [];
export const TUNING_HIRAGANA_NAME_LOOKAHEAD = "";
export const TUNING_NAME_FILTER_FEWSHOT = {
  user: ["鈴木さん", "テスト", "山田太郎さん"],
  assistant: ["鈴木さん", "山田太郎さん"],
} as const;

function mergeKeywordRules(core: KeywordRule[], tuning: KeywordRule[]): KeywordRule[] {
  const byCat = new Map<SensitiveCategory, string[]>();
  for (const rule of [...core, ...tuning]) {
    const prev = byCat.get(rule.category) ?? [];
    byCat.set(rule.category, [...prev, ...rule.phrases]);
  }
  return [...byCat.entries()].map(([category, phrases]) => ({
    category,
    phrases: [...new Set(phrases)],
  }));
}

export function getKeywordRules(): KeywordRule[] {
  return mergeKeywordRules(CORE_KEYWORD_RULES, TUNING_KEYWORD_RULES);
}

export function getKatakanaStopwords(): Set<string> {
  return new Set([...CORE_KATAKANA_STOPWORDS, ...TUNING_KATAKANA_STOPWORDS]);
}

export function getHiraganaStopwords(): Set<string> {
  return new Set([...CORE_HIRAGANA_STOPWORDS, ...TUNING_HIRAGANA_STOPWORDS]);
}

export function getSpeakerKanjiStopwords(): Set<string> {
  return new Set([...CORE_SPEAKER_KANJI_STOPWORDS, ...TUNING_SPEAKER_KANJI_STOPWORDS]);
}

export function getHiraganaNameLookahead(): string {
  const parts = ["さん", "くん", CORE_HIRAGANA_NAME_LOOKAHEAD, TUNING_HIRAGANA_NAME_LOOKAHEAD].filter(
    Boolean,
  );
  return parts.join("|");
}

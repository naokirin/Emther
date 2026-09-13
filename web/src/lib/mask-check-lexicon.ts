/**
 * 個人・機密情報チェックの語彙・ルール定義。
 *
 * - CORE: ドメイン横断で妥当な短い核（実値以外のヒューリスティックの最小セット）
 * - TUNING: 検証サンプル（インシデント議事録・リリース定例など）由来の積み上げ。
 *   過適合の温床になりうるため、コア実装と分離して管理する。
 *
 * 将来 Presidio / GiNZA 等へ寄せる場合、TUNING から見直す。
 */
import type { SensitiveCategory } from "@/lib/mask-check-types";

export type KeywordRule = { category: SensitiveCategory; phrases: string[] };

// ---------------------------------------------------------------------------
// CORE
// ---------------------------------------------------------------------------

/** 短い核フレーズのみ（長い言い回しは TUNING へ）。 */
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

/** カタカナ一般語の最小セット。 */
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

// ---------------------------------------------------------------------------
// TUNING（検証サンプル由来）
// ---------------------------------------------------------------------------

export const TUNING_KEYWORD_RULES: KeywordRule[] = [
  {
    category: "credential_mention",
    phrases: ["apiキー", "認証系", "不正利用", "不正に利用", "不正アクセス", "アカウントが不正", "アクセスを遮断"],
  },
  {
    category: "other_sensitive",
    phrases: [
      "セキュリティインシデント",
      "個人情報の漏洩",
      "個人情報が一部",
      "漏洩を伴う",
      "被害拡大",
      "不審なアクセス",
    ],
  },
  {
    category: "health",
    phrases: ["メンタル不調"],
  },
  {
    category: "compensation",
    phrases: ["年収交渉"],
  },
  {
    category: "customer_or_contract",
    phrases: ["顧客名"],
  },
];

export const TUNING_KATAKANA_STOPWORDS: readonly string[] = [
  "マネージャ",
  "マネージャー",
  "インシデント",
  "ストレージ",
  "クラウド",
  "メンバー",
  "レベル",
  "スレッド",
  "リリース",
  "シークレット",
  "キー",
  "アジュール",
  "サポート",
  "オンボーディング",
  "ミーティング",
  "チャット",
  "チャンネル",
  "ステータス",
  "コメント",
  "レビュー",
  "デプロイ",
  "インフラ",
  "プライバシー",
  "コンプライアンス",
  "サーバ",
  "サーバー",
  "クライアント",
  "オーナー",
  "リーダー",
  "メンバ",
  "テスト",
  "コピー",
  "サンプル",
  "パートナー",
  "テーブル",
  "ログイン",
  "ログアウト",
  "スクリーン",
  "ディスプレイ",
  "ブラウザ",
  "モバイル",
  "デスクトップ",
  "バックエンド",
  "フロント",
  "フロントエンド",
  "データベース",
  "クエリ",
  "エンドポイント",
  "リクエスト",
  "レスポンス",
  "セッション",
  "キャッシュ",
  "バックアップ",
  "ドキュメント",
  "マニュアル",
  "ガイドライン",
  "チェック",
  "リスト",
  "メール",
  "アドレス",
  "ナンバー",
  "ファイル",
  "フォルダ",
  "ページ",
  "エラー",
  "バグ",
  "フィックス",
  "アップデート",
  "バージョン",
  "プロダクト",
  "フィーチャー",
  "オプション",
  "パラメータ",
  "コンフィグ",
  "ポリシー",
  "ルール",
  "フロー",
  "プロセス",
  "タスク",
  "チケット",
  "アジェンダ",
  "サマリー",
  "レポート",
  "ダッシュボード",
  "アナリティクス",
  "マーケティング",
  "セールス",
  "カスタマー",
  "ベンダー",
  "コンサル",
  "エンジニア",
  "デザイナー",
  "ディレクター",
  "オペレーション",
  "オペレータ",
];

export const TUNING_HIRAGANA_STOPWORDS: readonly string[] = [
  "いったん",
  "あちら",
  "なにか",
  "ところ",
  "あたり",
  "かれら",
  "みんな",
  "ほかに",
  "ことに",
  "ものに",
  "において",
  "できる",
  "される",
  "ている",
  "ているか",
  "れている",
  "われている",
];

export const TUNING_SPEAKER_KANJI_STOPWORDS: readonly string[] = [
  "一部",
  "緊急",
  "認識",
  "進行",
  "残務",
  "法務",
  "役員",
  "範囲",
  "抑止",
  "被害",
  "議論",
  "優先",
  "全体",
  "協力",
  "確保",
  "実行",
  "判断",
  "集約",
  "議事",
  "抜粋",
  "個人",
  "漏洩",
];

/** 検証で出てきた「ただとしのアカウント」向け。コアには入れない。 */
export const TUNING_HIRAGANA_NAME_LOOKAHEAD = "のアカウント|の件";

/** 人名AIフィルタの few-shot（サンプル由来の一般語例を含む）。 */
export const TUNING_NAME_FILTER_FEWSHOT = {
  user: ["鈴木さん", "テスト", "ログイン", "山田太郎さん", "テーブル", "パートナー"],
  assistant: ["鈴木さん", "山田太郎さん"],
} as const;

// ---------------------------------------------------------------------------
// 合成
// ---------------------------------------------------------------------------

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

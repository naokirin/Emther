// 個人・機密情報チェック（docs/privacy_check.md）。
// 投入・外部送信の前に、登録済み人名のマスク結果と機微っぽい箇所をローカルだけで確認する。
// 副作用ゼロ: people-directory への登録／ack／永続化／外部 CLI・クラウド送信は一切しない。

import { extractFirstJsonObject, runLocalChat } from "@/lib/local-model";
import {
  getPersonId,
  isAcknowledgedUnmasked,
  isPlausiblePersonName,
  previewNameMask,
  type NameMaskReplacement,
} from "@/lib/people-directory";

export const MASK_CHECK_MAX_INPUT_CHARS = 50_000;
/** ローカル AI に渡す本文の上限（長文は先頭を使う）。 */
export const MASK_CHECK_AI_EXCERPT_CHARS = 6_000;
export const MASK_CHECK_MAX_RULE_FINDINGS = 30;
export const MASK_CHECK_MAX_AI_FINDINGS = 20;

export const MASK_CHECK_DISCLAIMER =
  "この画面は検証専用です。保存・外部送信・データ投入は行いません。" +
  "人名以外の機微情報は自動除去しません。" +
  "検出は推測を含み、漏れや誤検知があり得ます。目安として利用してください。";

export type SensitiveCategory =
  | "email"
  | "phone"
  | "url_secret"
  | "api_key_like"
  | "health"
  | "compensation"
  | "credential_mention"
  | "customer_or_contract"
  | "other_sensitive";

export type SensitiveFindingSource = "rule" | "local-ai";

export type SensitiveFinding = {
  category: SensitiveCategory;
  excerpt: string;
  source: SensitiveFindingSource;
};

export type MaskCheckQuickResult = {
  maskedText: string;
  nameReplacements: NameMaskReplacement[];
  sensitiveFindings: SensitiveFinding[];
  truncated: boolean;
  inputCharCount: number;
  disclaimer: string;
};

export type MaskCheckAiResult = {
  unregisteredNameCandidates: string[];
  sensitiveFindings: SensitiveFinding[];
  aiScopeNote: string;
  disclaimer: string;
};

const RULE_PATTERNS: { category: SensitiveCategory; re: RegExp }[] = [
  {
    category: "email",
    re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
    // 日本の電話番号っぽい並び（厳密な検証はしない）
    category: "phone",
    re: /(?:\+81[-\s]?)?0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/g,
  },
  {
    category: "api_key_like",
    re: /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16})\b/g,
  },
  {
    category: "url_secret",
    re: /https?:\/\/[^\s<>"']+[?&](?:access_token|api_key|token|key|secret|password|auth)=[^\s&<>"']+/gi,
  },
];

const AI_CATEGORIES = new Set<SensitiveCategory>([
  "health",
  "compensation",
  "credential_mention",
  "customer_or_contract",
  "other_sensitive",
]);

const SENSITIVE_AI_SYSTEM_PROMPT = [
  "入力テキストから、個人情報・機密情報の可能性がある箇所だけをJSONで列挙してください。",
  "説明や前置きは書かず、JSONオブジェクト1つだけを出力すること。",
  'フォーマット: {"findings":[{"category":string,"excerpt":string}],"people":string[]}',
  "categoryは次のいずれか: health, compensation, credential_mention, customer_or_contract, other_sensitive",
  "excerptは原文の短い抜粋（1文以内）。確信が低くても候補としてよい。無ければ空配列。",
  "peopleは人物名らしい語句（敬称はそのまま）。無ければ空配列。",
].join("\n");

function clipExcerpt(s: string, max = 80): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function normalizeInput(raw: string): { text: string; truncated: boolean; inputCharCount: number } {
  const inputCharCount = raw.length;
  if (raw.length <= MASK_CHECK_MAX_INPUT_CHARS) {
    return { text: raw, truncated: false, inputCharCount };
  }
  return {
    text: raw.slice(0, MASK_CHECK_MAX_INPUT_CHARS),
    truncated: true,
    inputCharCount,
  };
}

/** ルールベースの機微っぽい箇所検出（同期・副作用なし）。 */
export function detectSensitiveByRules(text: string): SensitiveFinding[] {
  const out: SensitiveFinding[] = [];
  const seen = new Set<string>();

  for (const { category, re } of RULE_PATTERNS) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const local = new RegExp(re.source, flags);
    let m: RegExpExecArray | null;
    while ((m = local.exec(text)) !== null) {
      const excerpt = clipExcerpt(m[0]);
      if (!excerpt) continue;
      // 電話の誤検知抑制: 数字が少なすぎる／日付っぽいだけのものはスキップ
      if (category === "phone") {
        const digits = excerpt.replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 15) continue;
      }
      const key = `${category}:${excerpt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ category, excerpt, source: "rule" });
      if (out.length >= MASK_CHECK_MAX_RULE_FINDINGS) return out;
    }
  }
  return out;
}

export function runMaskCheckQuick(rawText: string): MaskCheckQuickResult {
  const { text, truncated, inputCharCount } = normalizeInput(rawText);
  const { maskedText, replacements } = previewNameMask(text);
  return {
    maskedText,
    nameReplacements: replacements,
    sensitiveFindings: detectSensitiveByRules(text),
    truncated,
    inputCharCount,
    disclaimer: MASK_CHECK_DISCLAIMER,
  };
}

function parseAiFindings(content: string): {
  findings: SensitiveFinding[];
  people: string[];
} {
  const jsonText = extractFirstJsonObject(content);
  if (!jsonText) return { findings: [], people: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { findings: [], people: [] };
  }
  if (!parsed || typeof parsed !== "object") return { findings: [], people: [] };
  const obj = parsed as { findings?: unknown; people?: unknown };

  const findings: SensitiveFinding[] = [];
  const seen = new Set<string>();
  if (Array.isArray(obj.findings)) {
    for (const item of obj.findings) {
      if (!item || typeof item !== "object") continue;
      const cat = (item as { category?: unknown }).category;
      const excerptRaw = (item as { excerpt?: unknown }).excerpt;
      if (typeof cat !== "string" || typeof excerptRaw !== "string") continue;
      if (!AI_CATEGORIES.has(cat as SensitiveCategory)) continue;
      const excerpt = clipExcerpt(excerptRaw);
      if (!excerpt) continue;
      const key = `${cat}:${excerpt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        category: cat as SensitiveCategory,
        excerpt,
        source: "local-ai",
      });
      if (findings.length >= MASK_CHECK_MAX_AI_FINDINGS) break;
    }
  }

  const people: string[] = [];
  if (Array.isArray(obj.people)) {
    for (const p of obj.people) {
      if (typeof p !== "string") continue;
      const trimmed = p.trim();
      if (!isPlausiblePersonName(trimmed)) continue;
      if (getPersonId(trimmed)) continue;
      if (isAcknowledgedUnmasked(trimmed)) continue;
      if (!people.includes(trimmed)) people.push(trimmed);
    }
  }
  return { findings, people };
}

/**
 * ローカル AI による機微候補 + 未登録人名っぽい語句。
 * 登録・ack・永続化はしない。失敗時は空結果（呼び出し側で握りつぶし可能）。
 */
export async function runMaskCheckAi(rawText: string): Promise<MaskCheckAiResult> {
  const { text } = normalizeInput(rawText);
  const excerpt =
    text.length <= MASK_CHECK_AI_EXCERPT_CHARS
      ? text
      : text.slice(0, MASK_CHECK_AI_EXCERPT_CHARS);
  const aiScopeNote =
    text.length <= MASK_CHECK_AI_EXCERPT_CHARS
      ? `ローカルAIは全文（${text.length}文字）を確認しました。`
      : `ローカルAIは先頭${MASK_CHECK_AI_EXCERPT_CHARS}文字のみを確認しました（入力 ${text.length} 文字）。`;

  let sensitiveFindings: SensitiveFinding[] = [];
  let unregisteredNameCandidates: string[] = [];

  try {
    const content = await runLocalChat(
      [
        { role: "system", content: SENSITIVE_AI_SYSTEM_PROMPT },
        {
          role: "user",
          content: "来週のリリース日程をチームで確認した。特に個人の話は出ていない。",
        },
        {
          role: "assistant",
          content: JSON.stringify({ findings: [], people: [] }),
        },
        {
          role: "user",
          content:
            "Bさんがメンタル不調で休職検討、年収交渉もあった。顧客X社の契約金額は秘密。",
        },
        {
          role: "assistant",
          content: JSON.stringify({
            findings: [
              { category: "health", excerpt: "メンタル不調で休職検討" },
              { category: "compensation", excerpt: "年収交渉もあった" },
              { category: "customer_or_contract", excerpt: "顧客X社の契約金額は秘密" },
            ],
            people: ["Bさん"],
          }),
        },
        { role: "user", content: excerpt },
      ],
      280,
    );
    const parsed = parseAiFindings(content);
    sensitiveFindings = parsed.findings;
    unregisteredNameCandidates = parsed.people;
  } catch {
    // モデル未ロード・生成失敗は空で続行。ルール結果は quick 側にある。
    // 第2段はローカルAIを1回だけ呼び、人名NERの二重起動はしない。
  }

  return {
    unregisteredNameCandidates,
    sensitiveFindings,
    aiScopeNote,
    disclaimer: MASK_CHECK_DISCLAIMER,
  };
}

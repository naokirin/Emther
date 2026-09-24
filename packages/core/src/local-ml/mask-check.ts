// 個人・機密情報チェック。
// 投入・外部送信の前に、登録済み人名のマスク結果と機微っぽい箇所をローカルだけで確認する。
// 副作用ゼロ: people-directory への登録／ack／永続化／外部 CLI・クラウド送信は一切しない。
// 語彙・長いフレーズ・サンプル由来の除外リストは mask-check-lexicon.ts に分離
// （CORE＝短い核、TUNING＝検証積み上げ）。

// local-model / morph はルート shim 経由で import する。
// `@emther/core/local-model` 等の vi.mock と module identity を揃えるため。
import { extractFirstJsonObject, runLocalChat } from "../local-model";
import { getKeywordRules, TUNING_NAME_FILTER_FEWSHOT } from "./mask-check-lexicon";
import { ensureNameMorphReady } from "../mask-check-morph";
import type { SensitiveCategory } from "./mask-check-types";
import {
  dedupeNamesPreferHonorific,
  detectHonorificNameCandidates,
  detectNameCandidates,
  detectNameCandidatesAsync,
  expandNamesForHighlight,
  hasHonorific,
  isAcceptableBareNameCandidate,
  NAME_CANDIDATE_MAX,
} from "../name-candidate-detect";
import {
  getPersonId,
  isAcknowledgedUnmasked,
  isPlausiblePersonName,
  previewNameMask,
  type NameMaskReplacement,
} from "../people-directory";

export type { SensitiveCategory } from "./mask-check-types";
export {
  dedupeNamesPreferHonorific,
  detectHonorificNameCandidates,
  detectNameCandidates,
  detectNameCandidatesAsync,
  expandNamesForHighlight,
  isAcceptableBareNameCandidate,
};

export const MASK_CHECK_MAX_INPUT_CHARS = 50_000;
/** ローカル AI に渡す本文の上限（長文は先頭を使う）。 */
export const MASK_CHECK_AI_EXCERPT_CHARS = 6_000;
export const MASK_CHECK_MAX_RULE_FINDINGS = 40;
export const MASK_CHECK_MAX_AI_FINDINGS = 20;
export const MASK_CHECK_MAX_NAME_CANDIDATES = NAME_CANDIDATE_MAX;
export const MASK_CHECK_MAX_HIGHLIGHTS = 80;

export const MASK_CHECK_DISCLAIMER =
  "この画面は検証専用です。保存・外部送信・データ投入は行いません。" +
  "人名以外の機微情報は自動除去しません。" +
  "検出は推測を含み、漏れや誤検知があり得ます。" +
  "未公開情報・財務・人事などの文脈機微は目視とローカルAIの参考候補が中心です。";

export type SensitiveFindingSource = "rule" | "local-ai";

export type SensitiveFinding = {
  category: SensitiveCategory;
  /** 周辺抜粋（一覧表示用） */
  excerpt: string;
  /** 問題とみなした核となる語句（ハイライト用） */
  match: string;
  /** 原文（正規化後）上の開始インデックス。不明なら省略 */
  start?: number;
  /** 原文（正規化後）上の終了インデックス（排他）。不明なら省略 */
  end?: number;
  source: SensitiveFindingSource;
};

/** 原文ハイライト用（人名候補含む） */
export type TextHighlightKind = SensitiveCategory | "name_candidate";

export type TextHighlight = {
  start: number;
  end: number;
  kind: TextHighlightKind;
  match: string;
};

export type MaskCheckQuickResult = {
  /** 検出・ハイライト座標の基準となる本文（切り詰め後） */
  sourceText: string;
  maskedText: string;
  nameReplacements: NameMaskReplacement[];
  /** 未登録っぽい人名（敬称あり／なし。登録しない） */
  unregisteredNameCandidates: string[];
  sensitiveFindings: SensitiveFinding[];
  highlights: TextHighlight[];
  truncated: boolean;
  inputCharCount: number;
  disclaimer: string;
};

export type MaskCheckAiResult = {
  unregisteredNameCandidates: string[];
  sensitiveFindings: SensitiveFinding[];
  highlights: TextHighlight[];
  aiScopeNote: string;
  /** ローカルAIが有用なJSONを返せなかったとき true。 */
  aiWeak: boolean;
  disclaimer: string;
};

/** 実値パターン（メール・電話・鍵・住所・生年月日・ID・企業名など）。 */
const LITERAL_PATTERNS: { category: SensitiveCategory; re: RegExp }[] = [
  {
    category: "email",
    re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
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
  {
    category: "organization",
    // 社名本体は漢字・カタカナ・英数字のみ（「については」等のひらがなを食い込まない）
    re: /(?:株式会社|有限会社|合同会社|合資会社|合名会社)[一-龥々ァ-ヴーA-Za-z0-9・＝&-]{1,30}/g,
  },
  {
    category: "date_of_birth",
    // 単独の「10月15日」等と区別するため「生年月日」文脈を要求
    re: /生年月日[^。\n]{0,40}?\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g,
  },
  {
    category: "address",
    re: /(?:東京都|北海道|(?:京都|大阪)府|[一-龥々]{2,3}県)[一-龥々ぁ-んァ-ヴー0-9\-−ー]{1,24}?\d+\s*丁目(?:\d+\s*番(?:地)?)?(?:\d+\s*号)?/g,
  },
  {
    category: "identifier",
    // ラベル付きID / 顧客番号らしき記号
    re: /(?:ログインID|顧客番号|ユーザー名|ユーザ名|アカウントID)\s*[：:は]?\s*[`「『]?(?:[A-Za-z][A-Za-z0-9._-]{2,63}|[A-Z]?-?\d{4,})[`」』]?|\bC-\d{5,}\b/g,
  },
];

const AI_CATEGORIES = new Set<SensitiveCategory>([
  "health",
  "compensation",
  "credential_mention",
  "customer_or_contract",
  "organization",
  "other_sensitive",
]);

function isRegisteredOrAcked(name: string): boolean {
  return Boolean(getPersonId(name) || isAcknowledgedUnmasked(name));
}

const SENSITIVE_AI_SYSTEM_PROMPT = [
  "入力テキストから、(1)個人情報・機密情報の可能性がある箇所 (2)人物名 をJSONで列挙してください。",
  "説明や前置きは書かず、JSONオブジェクト1つだけを出力すること。",
  'フォーマット: {"findings":[{"category":string,"excerpt":string,"match":string}],"people":string[]}',
  "categoryは次のいずれか: health, compensation, credential_mention, customer_or_contract, organization, other_sensitive",
  "個人情報・漏洩・APIキー・認証情報・契約金額の言及は findings に入れる。",
  "未公開のリリース日・料金・財務数字・人事の内示・組織変更など、単語だけでは断定しにくい社外秘っぽい箇所も other_sensitive の参考候補として入れてよい（確信が無くても可）。",
  "matchは問題の核となる短い語句。excerptは周辺抜粋。",
  "peopleは人物名（敬称の有無どちらも可）。一般語は入れない。無ければ空配列。",
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

function excerptAround(text: string, index: number, length: number, radius = 28): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = `…${s}`;
  if (end < text.length) s = `${s}…`;
  return clipExcerpt(s, 100);
}

function pushFinding(
  out: SensitiveFinding[],
  seen: Set<string>,
  partial: Omit<SensitiveFinding, "source"> & { source?: SensitiveFindingSource },
): boolean {
  const source = partial.source ?? "rule";
  const excerpt = partial.excerpt;
  const match = partial.match || excerpt;
  if (!excerpt || out.length >= MASK_CHECK_MAX_RULE_FINDINGS) return false;
  const key = `${partial.category}:${match}:${partial.start ?? ""}:${excerpt}`;
  if (seen.has(key)) return true;
  seen.add(key);
  out.push({
    category: partial.category,
    excerpt,
    match,
    start: partial.start,
    end: partial.end,
    source,
  });
  return out.length < MASK_CHECK_MAX_RULE_FINDINGS;
}

const NAME_FILTER_SYSTEM_PROMPT = [
  "候補リストから人物の名前だけを残し、一般語彙・業務用語・システム用語は除外してください。",
  "説明や前置きは書かず、JSONオブジェクト1つだけを出力すること。",
  'フォーマット: {"people": string[]}',
  "残す語は入力候補の表記をそのまま使うこと。新規の名前を作らないこと。",
  "テスト・コピー・サンプル・テーブル・ログイン・パートナーなどのカタカナ一般語は人名ではない。",
].join("\n");

/**
 * ローカルAIで人名候補から明らかに一般語のものを落とす（副作用なし）。
 * 失敗時や空振り時は敬称付き候補を優先してフォールバック（消しすぎ防止）。
 */
export async function filterNameCandidatesWithLocalAi(candidates: string[]): Promise<{
  people: string[];
  filtered: boolean;
}> {
  const input = dedupeNamesPreferHonorific(candidates);
  if (input.length === 0) return { people: [], filtered: false };

  try {
    const content = await runLocalChat(
      [
        { role: "system", content: NAME_FILTER_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ candidates: [...TUNING_NAME_FILTER_FEWSHOT.user] }),
        },
        {
          role: "assistant",
          content: JSON.stringify({ people: [...TUNING_NAME_FILTER_FEWSHOT.assistant] }),
        },
        {
          role: "user",
          content: JSON.stringify({ candidates: input }),
        },
      ],
      Math.min(220, 40 + input.length * 12),
    );
    const jsonText = extractFirstJsonObject(content);
    if (!jsonText) {
      return { people: input.filter(hasHonorific).length > 0 ? input.filter(hasHonorific) : input, filtered: false };
    }
    const parsed = JSON.parse(jsonText) as { people?: unknown };
    if (!Array.isArray(parsed.people)) {
      return { people: input.filter(hasHonorific).length > 0 ? input.filter(hasHonorific) : input, filtered: false };
    }
    const allowed = new Set(input);
    const kept = parsed.people
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim())
      .filter((p) => allowed.has(p));
    const unique = dedupeNamesPreferHonorific(kept);

    // 消しすぎ防止: 結果が空で、入力に敬称付き人名があった場合は敬称付きだけ残す
    if (unique.length === 0) {
      const honorificOnly = input.filter(hasHonorific);
      return { people: honorificOnly.length > 0 ? honorificOnly : input, filtered: false };
    }
    return { people: unique, filtered: true };
  } catch {
    const honorificOnly = input.filter(hasHonorific);
    return { people: honorificOnly.length > 0 ? honorificOnly : input, filtered: false };
  }
}

/** ラテン文字を含むフレーズは大小無視で検索。それ以外は原文一致。 */
function findPhraseIndex(text: string, phrase: string, from: number): number {
  if (!phrase) return -1;
  if (/[A-Za-z]/.test(phrase)) {
    return text.toLowerCase().indexOf(phrase.toLowerCase(), from);
  }
  return text.indexOf(phrase, from);
}

/** ルールベースの機微っぽい箇所検出（同期・副作用なし）。 */
export function detectSensitiveByRules(text: string): SensitiveFinding[] {
  const out: SensitiveFinding[] = [];
  const seen = new Set<string>();

  for (const { category, re } of LITERAL_PATTERNS) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const local = new RegExp(re.source, flags);
    let m: RegExpExecArray | null;
    while ((m = local.exec(text)) !== null) {
      const match = m[0];
      const excerpt = clipExcerpt(match);
      if (!excerpt) continue;
      if (category === "phone") {
        const digits = excerpt.replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 15) continue;
      }
      if (
        !pushFinding(out, seen, {
          category,
          excerpt,
          match,
          start: m.index,
          end: m.index + match.length,
          source: "rule",
        })
      ) {
        return out;
      }
    }
  }

  // 同一フレーズの近接重複だけ抑える（別キーワードは同じ文でも残す）
  // ラテン文字を含むフレーズは大小無視（CORE の「APIキー」で「apiキー」も拾う）
  const hitStartsByPhrase = new Map<string, number[]>();

  for (const { category, phrases } of getKeywordRules()) {
    const sorted = [...phrases].sort((a, b) => b.length - a.length);
    for (const phrase of sorted) {
      let from = 0;
      while (from < text.length) {
        const idx = findPhraseIndex(text, phrase, from);
        if (idx === -1) break;
        const matchLen = phrase.length;
        const surface = text.slice(idx, idx + matchLen);
        const starts = hitStartsByPhrase.get(phrase) ?? [];
        const tooClose = starts.some((s) => Math.abs(s - idx) < 20);
        if (!tooClose) {
          const coveredByLonger = out.some(
            (f) =>
              f.start !== undefined &&
              f.end !== undefined &&
              f.start <= idx &&
              f.end >= idx + matchLen &&
              f.match.length > matchLen,
          );
          if (!coveredByLonger) {
            const excerpt = excerptAround(text, idx, matchLen);
            if (
              pushFinding(out, seen, {
                category,
                excerpt,
                match: surface,
                start: idx,
                end: idx + matchLen,
                source: "rule",
              })
            ) {
              starts.push(idx);
              hitStartsByPhrase.set(phrase, starts);
            } else {
              return out;
            }
          }
        }
        from = idx + matchLen;
      }
    }
  }

  return out;
}

function locateInText(text: string, needle: string): { start: number; end: number } | undefined {
  if (!needle) return undefined;
  const idx = text.indexOf(needle);
  if (idx === -1) return undefined;
  return { start: idx, end: idx + needle.length };
}

/** findings と人名候補から、重なりを解消したハイライト区間を作る。 */
export function buildTextHighlights(
  text: string,
  findings: SensitiveFinding[],
  names: string[],
): TextHighlight[] {
  type Raw = TextHighlight & { len: number };
  const raw: Raw[] = [];

  for (const f of findings) {
    let start = f.start;
    let end = f.end;
    const match = f.match || f.excerpt;
    if (start === undefined || end === undefined) {
      const loc = locateInText(text, match);
      if (!loc) continue;
      start = loc.start;
      end = loc.end;
    }
    if (start < 0 || end > text.length || start >= end) continue;
    raw.push({
      start,
      end,
      kind: f.category,
      match: text.slice(start, end),
      len: end - start,
    });
  }

  for (const name of names) {
    if (!name) continue;
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(name, from);
      if (idx === -1) break;
      raw.push({
        start: idx,
        end: idx + name.length,
        kind: "name_candidate",
        match: name,
        len: name.length,
      });
      from = idx + name.length;
    }
  }

  // 長い区間を優先し、重なる短い方を落とす
  raw.sort((a, b) => b.len - a.len || a.start - b.start);
  const accepted: TextHighlight[] = [];
  for (const h of raw) {
    const overlaps = accepted.some((a) => !(h.end <= a.start || h.start >= a.end));
    if (overlaps) continue;
    accepted.push({ start: h.start, end: h.end, kind: h.kind, match: h.match });
    if (accepted.length >= MASK_CHECK_MAX_HIGHLIGHTS) break;
  }
  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

export async function runMaskCheckQuick(rawText: string): Promise<MaskCheckQuickResult> {
  const { text, truncated, inputCharCount } = normalizeInput(rawText);
  await ensureNameMorphReady();
  const { maskedText, replacements } = previewNameMask(text);
  const unregisteredNameCandidates = detectNameCandidates(text);
  const sensitiveFindings = detectSensitiveByRules(text);
  const highlights = buildTextHighlights(
    text,
    sensitiveFindings,
    expandNamesForHighlight(unregisteredNameCandidates),
  );
  return {
    sourceText: text,
    maskedText,
    nameReplacements: replacements,
    unregisteredNameCandidates,
    sensitiveFindings,
    highlights,
    truncated,
    inputCharCount,
    disclaimer: MASK_CHECK_DISCLAIMER,
  };
}

function parseAiFindings(
  content: string,
  sourceText: string,
): {
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
      const matchRaw = (item as { match?: unknown }).match;
      if (typeof cat !== "string" || typeof excerptRaw !== "string") continue;
      if (!AI_CATEGORIES.has(cat as SensitiveCategory)) continue;
      const excerpt = clipExcerpt(excerptRaw);
      if (!excerpt) continue;
      const match =
        typeof matchRaw === "string" && matchRaw.trim()
          ? clipExcerpt(matchRaw.trim(), 40)
          : excerpt;
      const loc = locateInText(sourceText, match) ?? locateInText(sourceText, excerpt);
      const key = `${cat}:${match}:${loc?.start ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        category: cat as SensitiveCategory,
        excerpt,
        match,
        start: loc?.start,
        end: loc?.end,
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
      const ok = /(?:さん|くん|ちゃん|様|氏)$/.test(trimmed)
        ? isPlausiblePersonName(trimmed)
        : isAcceptableBareNameCandidate(trimmed);
      if (!ok) continue;
      if (isRegisteredOrAcked(trimmed)) continue;
      if (!people.includes(trimmed)) people.push(trimmed);
    }
  }
  return { findings, people };
}

function mergeUniqueNames(a: string[], b: string[]): string[] {
  return dedupeNamesPreferHonorific([...a, ...b]).slice(0, MASK_CHECK_MAX_NAME_CANDIDATES);
}

/**
 * ローカル AI による追加の機微候補 + 人名。
 * 登録・ack・永続化はしない。失敗時は空＋ aiWeak。
 */
export async function runMaskCheckAi(rawText: string): Promise<MaskCheckAiResult> {
  const { text } = normalizeInput(rawText);
  const excerpt =
    text.length <= MASK_CHECK_AI_EXCERPT_CHARS
      ? text
      : text.slice(0, MASK_CHECK_AI_EXCERPT_CHARS);
  const ruleNames = await detectNameCandidatesAsync(text);
  const aiScopeNote =
    (text.length <= MASK_CHECK_AI_EXCERPT_CHARS
      ? `ローカルAIは全文（${text.length}文字）を確認しました。`
      : `ローカルAIは先頭${MASK_CHECK_AI_EXCERPT_CHARS}文字のみを確認しました（入力 ${text.length} 文字）。`) +
    "未公開・財務・人事などの文脈機微は参考候補です（必須検知ではありません）。";

  let sensitiveFindings: SensitiveFinding[] = [];
  let peopleFromAi: string[] = [];
  let aiWeak = false;

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
            "高井: 個人情報の漏洩インシデント。Azureへの不正アクセス。ただとしのアカウント不正利用とAPIキーを閉じた。トニーも参加。",
        },
        {
          role: "assistant",
          content: JSON.stringify({
            findings: [
              {
                category: "other_sensitive",
                excerpt: "個人情報の漏洩インシデント",
                match: "個人情報の漏洩",
              },
              {
                category: "credential_mention",
                excerpt: "アカウント不正利用とAPIキーを閉じた",
                match: "APIキー",
              },
            ],
            people: ["高井", "ただとし", "トニー"],
          }),
        },
        { role: "user", content: excerpt },
      ],
      400,
    );
    const parsed = parseAiFindings(content, text);
    sensitiveFindings = parsed.findings;
    peopleFromAi = parsed.people;
    if (parsed.findings.length === 0 && parsed.people.length === 0) {
      aiWeak = true;
    }
  } catch {
    aiWeak = true;
  }

  const merged = mergeUniqueNames(ruleNames, peopleFromAi);
  const nameFilter = await filterNameCandidatesWithLocalAi(merged);
  const unregisteredNameCandidates = nameFilter.people;
  const highlights = buildTextHighlights(
    text,
    sensitiveFindings,
    expandNamesForHighlight(unregisteredNameCandidates),
  );

  const filterNote = nameFilter.filtered
    ? " 人名候補はローカルAIで一般語を除外済みです。"
    : "";

  return {
    unregisteredNameCandidates,
    sensitiveFindings,
    highlights,
    aiScopeNote: aiWeak
      ? `${aiScopeNote} ローカルAIからの機微追加検出は得られませんでした（ルール結果を主に参照してください）。${filterNote}`
      : `${aiScopeNote}${filterNote}`,
    aiWeak,
    disclaimer: MASK_CHECK_DISCLAIMER,
  };
}

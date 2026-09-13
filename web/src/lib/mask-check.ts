// 個人・機密情報チェック（docs/privacy_check.md）。
// 投入・外部送信の前に、登録済み人名のマスク結果と機微っぽい箇所をローカルだけで確認する。
// 副作用ゼロ: people-directory への登録／ack／永続化／外部 CLI・クラウド送信は一切しない。
//
// 語彙・長いフレーズ・サンプル由来の除外リストは mask-check-lexicon.ts に分離
// （CORE＝短い核、TUNING＝検証積み上げ）。

import { extractFirstJsonObject, runLocalChat } from "@/lib/local-model";
import {
  getHiraganaNameLookahead,
  getHiraganaStopwords,
  getKatakanaStopwords,
  getKeywordRules,
  getSpeakerKanjiStopwords,
  TUNING_NAME_FILTER_FEWSHOT,
} from "@/lib/mask-check-lexicon";
import type { SensitiveCategory } from "@/lib/mask-check-types";
import {
  getPersonId,
  isAcknowledgedUnmasked,
  isPlausiblePersonName,
  previewNameMask,
  stripPersonHonorific,
  type NameMaskReplacement,
} from "@/lib/people-directory";

export type { SensitiveCategory } from "@/lib/mask-check-types";

export const MASK_CHECK_MAX_INPUT_CHARS = 50_000;
/** ローカル AI に渡す本文の上限（長文は先頭を使う）。 */
export const MASK_CHECK_AI_EXCERPT_CHARS = 6_000;
export const MASK_CHECK_MAX_RULE_FINDINGS = 40;
export const MASK_CHECK_MAX_AI_FINDINGS = 20;
export const MASK_CHECK_MAX_NAME_CANDIDATES = 50;
export const MASK_CHECK_MAX_HIGHLIGHTS = 80;

export const MASK_CHECK_DISCLAIMER =
  "この画面は検証専用です。保存・外部送信・データ投入は行いません。" +
  "人名以外の機微情報は自動除去しません。" +
  "検出は推測を含み、漏れや誤検知があり得ます。目安として利用してください。";

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

/** 実値パターン（メール・電話・鍵文字列など）。コアとして健全。 */
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
];

/** 敬称付き人名（文字種を混ぜない）。 */
const HONORIFIC_NAME_RE =
  /(?:[一-龥々]{1,4}|[ぁ-ん]{2,10}|[ァ-ヴー]{2,10}|[A-Za-z][A-Za-z\-']{1,11})(?:さん|くん|ちゃん|様|氏)/g;

/** 議事録の話者ラベル（行頭〜：/:）。 */
const SPEAKER_LABEL_RE = /(?:^|\n)\s*([^\s：:\n]{1,12})\s*[：:]/g;

/** カタカナは最長一致。長い複合語は丸ごと捨て、短い候補だけ残す。 */
const KATAKANA_MAXIMAL_RE = /[ァ-ヴー]{2,}/g;
const KATAKANA_NAME_MAX_LEN = 5;

/** 人名候補に含めたくない区切り。「と」は「とし」等のため除外。 */
const NAME_INTERNAL_NOISE_RE = /[がはをにでもへ＆&／/\s]|の/;

const AI_CATEGORIES = new Set<SensitiveCategory>([
  "health",
  "compensation",
  "credential_mention",
  "customer_or_contract",
  "other_sensitive",
]);

const SENSITIVE_AI_SYSTEM_PROMPT = [
  "入力テキストから、(1)個人情報・機密情報の可能性がある箇所 (2)人物名 をJSONで列挙してください。",
  "説明や前置きは書かず、JSONオブジェクト1つだけを出力すること。",
  'フォーマット: {"findings":[{"category":string,"excerpt":string,"match":string}],"people":string[]}',
  "categoryは次のいずれか: health, compensation, credential_mention, customer_or_contract, other_sensitive",
  "個人情報・漏洩・インシデント・APIキー・不正アクセス・アカウント不正利用の言及は必ず findings に入れる。",
  "matchは問題の核となる短い語句。excerptは周辺抜粋。",
  "peopleは人物名（敬称の有無どちらも可）。無ければ空配列。",
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

function isRegisteredOrAcked(name: string): boolean {
  return Boolean(getPersonId(name) || isAcknowledgedUnmasked(name));
}

function hasHonorific(name: string): boolean {
  return /(?:さん|くん|ちゃん|様|氏)$/.test(name);
}

/** bare / 話者 / カタカナ用の受け入れ判定。 */
export function isAcceptableBareNameCandidate(name: string): boolean {
  const t = name.trim();
  if (t.length < 2 || t.length > 12) return false;
  if (isRegisteredOrAcked(t)) return false;
  if (getKatakanaStopwords().has(t)) return false;
  if (getSpeakerKanjiStopwords().has(t)) return false;
  if (getHiraganaStopwords().has(t)) return false;
  // 「自分とUMの田中」のような助詞食い込みを落とす
  if (NAME_INTERNAL_NOISE_RE.test(stripPersonHonorific(t) || t)) return false;

  if (hasHonorific(t)) {
    return isPlausiblePersonName(t);
  }
  if (/^[ァ-ヴー]+$/.test(t)) {
    return t.length >= 2 && t.length <= KATAKANA_NAME_MAX_LEN;
  }
  if (/^[一-龥々]{2,4}$/.test(t)) {
    return true;
  }
  if (/^[ぁ-ん]{2,10}$/.test(t)) {
    return true;
  }
  if (/^[A-Za-z][A-Za-z\-']{1,11}$/.test(t)) {
    const lower = t.toLowerCase();
    if (["slack", "azure", "sre", "api", "okr", "mtg", "um"].includes(lower)) return false;
    return true;
  }
  return false;
}

function tryAddName(found: string[], seen: Set<string>, raw: string): void {
  const name = raw.trim();
  if (!name || seen.has(name)) return;
  if (isRegisteredOrAcked(name)) return;

  if (hasHonorific(name)) {
    const bare = stripPersonHonorific(name);
    if (!bare || NAME_INTERNAL_NOISE_RE.test(bare)) return;
    if (!isPlausiblePersonName(name)) return;
  } else if (!isAcceptableBareNameCandidate(name)) {
    return;
  }

  seen.add(name);
  found.push(name);
}

/** 同一人物の敬称あり／なしは敬称ありを優先して1つにまとめる。 */
export function dedupeNamesPreferHonorific(names: string[]): string[] {
  const byBare = new Map<string, string>();
  for (const n of names) {
    const bare = stripPersonHonorific(n) || n;
    const prev = byBare.get(bare);
    if (!prev) {
      byBare.set(bare, n);
      continue;
    }
    if (hasHonorific(n) && !hasHonorific(prev)) byBare.set(bare, n);
  }
  // 「中村さん」と「中村一郎さん」のように短い方が長い方に含まれる場合は長い方だけ残す
  const items = [...byBare.values()].map((n) => ({ n, bare: stripPersonHonorific(n) || n }));
  return items
    .filter(
      (a) =>
        !items.some(
          (b) => a.n !== b.n && b.bare.length > a.bare.length && b.bare.includes(a.bare),
        ),
    )
    .map((x) => x.n);
}

/** ハイライト用に敬称あり候補の bare 形も展開（一覧には出さない）。 */
export function expandNamesForHighlight(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    for (const form of [n, stripPersonHonorific(n)]) {
      const t = form?.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  // 長い方を先に（トニーさんをトニーより先に塗る）
  return out.sort((a, b) => b.length - a.length);
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

/**
 * 未登録の人名っぽい語句（同期・副作用なし）。
 * 一覧は敬称ありを優先して重複除去。カタカナは最長一致かつ短いものだけ。
 */
export function detectNameCandidates(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const honorificRe = new RegExp(HONORIFIC_NAME_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = honorificRe.exec(text)) !== null) {
    tryAddName(found, seen, m[0]);
    if (found.length >= MASK_CHECK_MAX_NAME_CANDIDATES) break;
  }

  // 話者ラベル（敬称なしの「高井:」など）
  const speakerRe = new RegExp(SPEAKER_LABEL_RE.source, "gm");
  while ((m = speakerRe.exec(text)) !== null) {
    const label = (m[1] ?? "").trim();
    if (!label) continue;
    tryAddName(found, seen, label);
    if (found.length >= MASK_CHECK_MAX_NAME_CANDIDATES) break;
  }

  // カタカナ最長一致 → 短い人名だけ（長い複合語は丸ごと捨てる）
  const kataRe = new RegExp(KATAKANA_MAXIMAL_RE.source, "g");
  while ((m = kataRe.exec(text)) !== null) {
    const run = m[0];
    if (run.length < 2 || run.length > KATAKANA_NAME_MAX_LEN) continue;
    tryAddName(found, seen, run);
    if (found.length >= MASK_CHECK_MAX_NAME_CANDIDATES) break;
  }

  // ひらがな名は文脈限定（ただとしのアカウント 等）。一般助詞パターンは使わない。
  const hiraLookahead = getHiraganaNameLookahead();
  const hiraRe = new RegExp(`[ぁ-ん]{3,8}(?=${hiraLookahead})`, "g");
  while ((m = hiraRe.exec(text)) !== null) {
    tryAddName(found, seen, m[0]);
    if (found.length >= MASK_CHECK_MAX_NAME_CANDIDATES) break;
  }

  return dedupeNamesPreferHonorific(found).slice(0, MASK_CHECK_MAX_NAME_CANDIDATES);
}

/** @deprecated detectNameCandidates を使用。後方互換の別名。 */
export function detectHonorificNameCandidates(text: string): string[] {
  return detectNameCandidates(text);
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
      let excerpt = clipExcerpt(match);
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
  const hitStartsByPhrase = new Map<string, number[]>();

  for (const { category, phrases } of getKeywordRules()) {
    const sorted = [...phrases].sort((a, b) => b.length - a.length);
    for (const phrase of sorted) {
      let from = 0;
      while (from < text.length) {
        const idx = text.indexOf(phrase, from);
        if (idx === -1) break;
        const starts = hitStartsByPhrase.get(phrase) ?? [];
        const tooClose = starts.some((s) => Math.abs(s - idx) < 20);
        if (!tooClose) {
          const coveredByLonger = out.some(
            (f) =>
              f.start !== undefined &&
              f.end !== undefined &&
              f.start <= idx &&
              f.end >= idx + phrase.length &&
              f.match.length > phrase.length,
          );
          if (!coveredByLonger) {
            const excerpt = excerptAround(text, idx, phrase.length);
            if (
              pushFinding(out, seen, {
                category,
                excerpt,
                match: phrase,
                start: idx,
                end: idx + phrase.length,
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
        from = idx + phrase.length;
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

export function runMaskCheckQuick(rawText: string): MaskCheckQuickResult {
  const { text, truncated, inputCharCount } = normalizeInput(rawText);
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
  const ruleNames = detectNameCandidates(text);
  const aiScopeNote =
    text.length <= MASK_CHECK_AI_EXCERPT_CHARS
      ? `ローカルAIは全文（${text.length}文字）を確認しました。`
      : `ローカルAIは先頭${MASK_CHECK_AI_EXCERPT_CHARS}文字のみを確認しました（入力 ${text.length} 文字）。`;

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

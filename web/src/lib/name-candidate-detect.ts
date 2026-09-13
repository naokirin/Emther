// 人名候補検出（副作用なし・登録しない）。
// `/mask-check` のプレビューと、厳格確認オプトイン時の ensureNameCandidatesAllowed が共用する。
// 語彙は mask-check-lexicon、形態素は mask-check-morph。名簿照合は people-directory。

import {
  getHiraganaNameLookahead,
  getHiraganaStopwords,
  getKatakanaStopwords,
  getSpeakerKanjiStopwords,
} from "@/lib/mask-check-lexicon";
import { detectMorphPersonNames, ensureNameMorphReady } from "@/lib/mask-check-morph";
import {
  getPersonId,
  isAcknowledgedUnmasked,
  isPlausiblePersonName,
  stripPersonHonorific,
} from "@/lib/people-directory";

/** 1テキストあたりの候補上限（プレビュー・確認ゲート共通）。 */
export const NAME_CANDIDATE_MAX = 50;

/**
 * 敬称付き人名。漢字は2〜8文字（佐々木花子など）。
 * 「様」は仕様・同様など一般語にも含まれるため、表面形ストップで落とす。
 */
const HONORIFIC_NAME_RE =
  /(?:[一-龥々]{2,8}|[ぁ-ん]{2,10}|[ァ-ヴー]{2,10}|[A-Za-z][A-Za-z\-']{1,11})(?:さん|くん|ちゃん|様|氏)/g;

/** 「〜様」に誤マッチしやすい一般語（敬称として採用しない）。 */
const HONORIFIC_SURFACE_STOPWORDS = new Set([
  "仕様",
  "同様",
  "客様",
  "神様",
  "多様",
  "模様",
  "有様",
  "異様",
  "殿様",
  "皆様",
]);

/** 議事録の話者ラベル（行頭〜：/:）。 */
const SPEAKER_LABEL_RE = /(?:^|\n)\s*([^\s：:\n]{1,12})\s*[：:]/g;

/**
 * カタカナ自由検出は FP が多いため使わない（FP抑制優先）。
 * カタカナ人名は「トニーさん」等の敬称付き、または話者ラベルから拾う。
 */
const KATAKANA_NAME_MAX_LEN = 5;

/** 人名候補に含めたくない区切り。「と」は「とし」等のため除外。 */
const NAME_INTERNAL_NOISE_RE = /[がはをにでもへ＆&／/\s]|の/;

function isRegisteredOrAcked(name: string): boolean {
  return Boolean(getPersonId(name) || isAcknowledgedUnmasked(name));
}

export function hasHonorific(name: string): boolean {
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
    if (HONORIFIC_SURFACE_STOPWORDS.has(name)) return;
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

/**
 * 未登録の人名っぽい語句（同期・副作用なし）。
 * 敬称・話者・ひらがな文脈に加え、Kuromoji 人名 POS（ロード済み時）をマージ。
 * FP抑制のためカタカナの自由検出は行わない。
 */
export function detectNameCandidates(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const honorificRe = new RegExp(HONORIFIC_NAME_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = honorificRe.exec(text)) !== null) {
    tryAddName(found, seen, m[0]);
    if (found.length >= NAME_CANDIDATE_MAX) break;
  }

  // 話者ラベル（敬称なしの「高井:」など）
  const speakerRe = new RegExp(SPEAKER_LABEL_RE.source, "gm");
  while ((m = speakerRe.exec(text)) !== null) {
    const label = (m[1] ?? "").trim();
    if (!label) continue;
    tryAddName(found, seen, label);
    if (found.length >= NAME_CANDIDATE_MAX) break;
  }

  // ひらがな名は文脈限定（ただとしのアカウント 等）
  const hiraLookahead = getHiraganaNameLookahead();
  const hiraRe = new RegExp(`[ぁ-ん]{3,8}(?=${hiraLookahead})`, "g");
  while ((m = hiraRe.exec(text)) !== null) {
    tryAddName(found, seen, m[0]);
    if (found.length >= NAME_CANDIDATE_MAX) break;
  }

  // 形態素人名 POS（敬称なし姓・外国人名など）。辞書未ロードならスキップ。
  for (const name of detectMorphPersonNames(text)) {
    tryAddName(found, seen, name);
    if (found.length >= NAME_CANDIDATE_MAX) break;
  }

  return dedupeNamesPreferHonorific(found).slice(0, NAME_CANDIDATE_MAX);
}

/** 形態素辞書を載せてから人名候補を返す。 */
export async function detectNameCandidatesAsync(text: string): Promise<string[]> {
  await ensureNameMorphReady();
  return detectNameCandidates(text);
}

/** @deprecated detectNameCandidates を使用。後方互換の別名。 */
export function detectHonorificNameCandidates(text: string): string[] {
  return detectNameCandidates(text);
}

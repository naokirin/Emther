import "./transformers-env";
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  type ProgressCallback,
} from "@huggingface/transformers";
import { getTransformersCacheDir } from "./transformers-env";
import { getRulesAndConstraints } from "../settings-store";
import { withTransformersInferenceLock } from "./transformers-inference-lock";

// opt-in: 関連束・紐づけ heuristic などの候補並べ替え用クロスエンコーダ。
// 既定 OFF（localRerankEnabled）。ON 時のみ遅延ロード。失敗時は呼び出し側が cosine 順にフォールバック。
// モデルは軽量検証で選定。
// hotchpotch/japanese-reranker-tiny-v2 の HF onnx/ は model.onnx（fp32）のみで、
// Transformers.js の dtype=q8 が要求する model_quantized.onnx は無い。
// そのため fp32 を先に試し、失敗時のみ q8 へフォールバックする。

export const RERANKER_MODEL = {
  id: "hotchpotch/japanese-reranker-tiny-v2",
  /** 試行順。キャッシュに存在する dtype を優先する。 */
  dtypes: ["fp32", "q8"] as const,
};

/** cosine で足切りした候補を rerank する上限（評価ハーネスと同じ）。 */
export const RERANK_CANDIDATE_LIMIT = 20;

/** クロスエンコーダ入力の文字上限（長文クエリ×候補で ONNX バッファが肥大するのを防ぐ）。 */
export const RERANK_TEXT_CHAR_LIMIT = 512;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenizerPromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modelPromise: Promise<any> | null = null;
/** from_pretrained の単一フライト（並列 consult で孤児 Promise を出さない）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ensurePromise: Promise<{ tokenizer: any; model: any }> | null = null;
let rerankerReady = false;
let lastLoadFailed = false;

function isRerankerLoadPending(): boolean {
  return ensurePromise !== null && !rerankerReady;
}

export function isLocalRerankEnabled(): boolean {
  return getRulesAndConstraints().localRerankEnabled === true;
}

export function isRerankerBusyOrFailed(): boolean {
  return lastLoadFailed || isRerankerLoadPending();
}

export function clearRerankerCache() {
  tokenizerPromise = null;
  modelPromise = null;
  ensurePromise = null;
  rerankerReady = false;
  lastLoadFailed = false;
}

export function markRerankerUnavailable() {
  tokenizerPromise = null;
  modelPromise = null;
  ensurePromise = null;
  rerankerReady = false;
  lastLoadFailed = true;
}

function asDocumentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function clipForRerank(text: string): string {
  if (text.length <= RERANK_TEXT_CHAR_LIMIT) return text;
  return text.slice(0, RERANK_TEXT_CHAR_LIMIT);
}

async function loadModelWithDtypeFallback(progress_callback?: ProgressCallback) {
  let lastErr: unknown;
  for (const dtype of RERANKER_MODEL.dtypes) {
    try {
      return await AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL.id, {
        dtype,
        progress_callback,
        cache_dir: getTransformersCacheDir(),
      });
    } catch (err) {
      lastErr = err;
      console.warn(
        `[reranker] dtype=${dtype} のロードに失敗: ${(err as Error).message ?? String(err)}`,
      );
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function ensureReranker(progress_callback?: ProgressCallback) {
  if (rerankerReady && tokenizerPromise && modelPromise) {
    const [tokenizer, model] = await Promise.all([tokenizerPromise, modelPromise]);
    return { tokenizer, model };
  }
  if (!ensurePromise) {
    lastLoadFailed = false;
    ensurePromise = (async () => {
      try {
        if (!tokenizerPromise) {
          tokenizerPromise = AutoTokenizer.from_pretrained(RERANKER_MODEL.id, {
            progress_callback,
            cache_dir: getTransformersCacheDir(),
          });
        }
        if (!modelPromise) {
          modelPromise = loadModelWithDtypeFallback(progress_callback);
        }
        const [tokenizer, model] = await Promise.all([tokenizerPromise, modelPromise]);
        rerankerReady = true;
        lastLoadFailed = false;
        return { tokenizer, model };
      } catch (err) {
        markRerankerUnavailable();
        throw err;
      }
    })();
  }
  return ensurePromise;
}

/**
 * query と各 document の関連スコア（高いほど関連）。生 logit。
 * モデル未準備・失敗時は throw（呼び出し側でフォールバック）。
 */
export async function scoreQueryDocuments(
  query: string,
  documents: string[],
  progress_callback?: ProgressCallback,
): Promise<number[]> {
  const docs = documents.map((d) => clipForRerank(asDocumentText(d)));
  if (docs.length === 0) return [];
  // ロード中は待ち行列にせず即失敗→呼び出し側が cosine へフォールバック（レイテンシ優先）。
  // ただし単一フライトの ensurePromise 自体は並行呼び出しで共有され、孤児 reject は出さない。
  if (lastLoadFailed) {
    throw new Error("local reranker model is unavailable");
  }
  if (isRerankerLoadPending() && !rerankerReady) {
    throw new Error("local reranker model is not ready");
  }
  return withTransformersInferenceLock(async () => {
    const { tokenizer, model } = await ensureReranker(progress_callback);
    const q = clipForRerank(asDocumentText(query));
    const inputs = tokenizer(
      docs.map(() => q),
      { text_pair: docs, padding: true, truncation: true },
    );
    const { logits } = await model(inputs);
    const data = logits?.data ?? logits;
    const arr = Array.from(data as Float32Array | number[]);
    if (arr.length === docs.length) return arr;
    if (arr.length === docs.length * 2) {
      const scores: number[] = [];
      for (let i = 0; i < docs.length; i++) {
        scores.push(arr[i * 2 + 1] - arr[i * 2]);
      }
      return scores;
    }
    const per = Math.max(1, Math.floor(arr.length / docs.length));
    return docs.map((_, i) => arr[i * per + (per - 1)]);
  });
}

/**
 * 設定 ON かつ候補が2件以上のときだけ rerank で並べ替える。
 * OFF・失敗・1件以下はそのまま（安定フォールバック）。
 * 元の配列順・フィールドは維持し、順序だけ変える。
 */
export async function maybeRerankByText<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
): Promise<T[]> {
  if (!isLocalRerankEnabled() || items.length <= 1) return items;
  const docs = items.map((item) => asDocumentText(getText(item)));
  if (docs.every((d) => !d.trim())) return items;
  try {
    const scores = await scoreQueryDocuments(query, docs);
    return items
      .map((item, i) => ({ item, score: scores[i] ?? Number.NEGATIVE_INFINITY }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  } catch {
    return items;
  }
}

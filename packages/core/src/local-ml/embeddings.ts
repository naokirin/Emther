import "./transformers-env";
import { pipeline, type ProgressCallback } from "@huggingface/transformers";
import { getTransformersCacheDir } from "./transformers-env";
import { withTransformersInferenceLock } from "./transformers-inference-lock";

// 埋め込みも外部送信せず、
// local-model.ts（チャット生成）とは別に、文埋め込み専用の小さなモデルをロードする。
// 日本語を含む多言語の意味的類似度が必要なため、英語専用のall-MiniLMではなく
// 多言語対応のparaphrase-multilingual-MiniLM-L12-v2を採用（実機で日本語の類似/非類似
// ペアの区別ができることを確認済み）。量子化(q8)で約118MBに抑えている。
// 未キャッシュ時の起動ダウンロード＋進捗表示は model-loader.ts が担う。
export const EMBEDDING_MODEL = {
  task: "feature-extraction" as const,
  id: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  dtype: "q8" as const,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedderPromise: Promise<any> | null = null;
let embedderReady = false;
let lastLoadFailed = false;

function isEmbedderLoadPending(): boolean {
  return embedderPromise !== null && !embedderReady;
}

export function isEmbedderBusyOrFailed(): boolean {
  return lastLoadFailed || isEmbedderLoadPending();
}

export function getEmbedder(progress_callback?: ProgressCallback) {
  if (!embedderPromise) {
    embedderReady = false;
    lastLoadFailed = false;
    const resultPromise = pipeline(EMBEDDING_MODEL.task, EMBEDDING_MODEL.id, {
      dtype: EMBEDDING_MODEL.dtype,
      progress_callback,
      cache_dir: getTransformersCacheDir(),
    }).then(
      (embedder) => {
        if (embedderPromise !== resultPromise) return embedder;
        embedderReady = true;
        lastLoadFailed = false;
        return embedder;
      },
      (err) => {
        if (embedderPromise === resultPromise) markEmbedderUnavailable();
        throw err;
      },
    );
    embedderPromise = resultPromise;
  }
  return embedderPromise;
}

/** pipeline 失敗後に再試行できるよう、拒否済み Promise を捨てる。 */
export function clearEmbedderCache() {
  embedderPromise = null;
  embedderReady = false;
  lastLoadFailed = false;
}

export function markEmbedderUnavailable() {
  embedderPromise = null;
  embedderReady = false;
  lastLoadFailed = true;
}

export async function embedText(text: string): Promise<number[]> {
  if (isEmbedderBusyOrFailed()) {
    throw new Error("local embedding model is not ready");
  }
  return withTransformersInferenceLock(async () => {
    const embedder = await getEmbedder();
    const output = await embedder(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  });
}

// 埋め込みはembedText内でnormalize:trueにより単位ベクトル化しているため、
// 本来は内積だけでコサイン類似度と一致するが、他の生成元（次元不一致等）が
// 混じっても壊れないよう、ここでは素直にコサイン類似度の定義通り計算する。
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

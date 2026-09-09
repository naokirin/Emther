import { ModelRegistry, type ProgressInfo } from "@huggingface/transformers";
import {
  clearLocalGeneratorCache,
  getLocalGenerator,
  LOCAL_CHAT_MODEL,
} from "@/lib/local-model";
import {
  clearEmbedderCache,
  EMBEDDING_MODEL,
  getEmbedder,
} from "@/lib/embeddings";

// ローカルモデル（チャット生成・埋め込み）のディスクキャッシュ有無を見て、
// 未取得なら起動直後にダウンロード＋メモリロードを開始し、進捗をUIへ返すための状態機械。
// モデルIDの設定切替はスコープ外（定数のまま）。キャッシュ済みなら pipeline() は呼ばず、
// 従来通り初回利用時の遅延ロードに任せる（メモリを起動時点で食わない）。

export type ModelSlotKey = "chat" | "embedding";
export type ModelLoadPhase = "idle" | "checking" | "downloading" | "ready" | "error";
export type ModelLoadOverall = "idle" | "checking" | "downloading" | "ready" | "error";

export type ModelSlotSnapshot = {
  key: ModelSlotKey;
  label: string;
  modelId: string;
  phase: ModelLoadPhase;
  /** 0–100。progress_total があればそれを使う。 */
  progress: number;
  loadedBytes: number | null;
  totalBytes: number | null;
  /** null = 未判定 */
  cached: boolean | null;
  error: string | null;
};

export type ModelLoadSnapshot = {
  overall: ModelLoadOverall;
  models: ModelSlotSnapshot[];
};

type SlotRuntime = {
  key: ModelSlotKey;
  label: string;
  modelId: string;
  task: string;
  dtype: string;
  phase: ModelLoadPhase;
  progress: number;
  loadedBytes: number | null;
  totalBytes: number | null;
  cached: boolean | null;
  error: string | null;
};

const slots: Record<ModelSlotKey, SlotRuntime> = {
  chat: {
    key: "chat",
    label: "ジャーナル抽出",
    modelId: LOCAL_CHAT_MODEL.id,
    task: LOCAL_CHAT_MODEL.task,
    dtype: LOCAL_CHAT_MODEL.dtype,
    phase: "idle",
    progress: 0,
    loadedBytes: null,
    totalBytes: null,
    cached: null,
    error: null,
  },
  embedding: {
    key: "embedding",
    label: "意味検索（埋め込み）",
    modelId: EMBEDDING_MODEL.id,
    task: EMBEDDING_MODEL.task,
    dtype: EMBEDDING_MODEL.dtype,
    phase: "idle",
    progress: 0,
    loadedBytes: null,
    totalBytes: null,
    cached: null,
    error: null,
  },
};

let warmPromise: Promise<void> | null = null;

/** テスト用: モジュール内状態を初期化する。本番コードからは呼ばない。 */
export function resetModelLoaderStateForTests() {
  warmPromise = null;
  for (const slot of Object.values(slots)) {
    slot.phase = "idle";
    slot.progress = 0;
    slot.loadedBytes = null;
    slot.totalBytes = null;
    slot.cached = null;
    slot.error = null;
  }
}

function snapshotSlot(slot: SlotRuntime): ModelSlotSnapshot {
  return {
    key: slot.key,
    label: slot.label,
    modelId: slot.modelId,
    phase: slot.phase,
    progress: slot.progress,
    loadedBytes: slot.loadedBytes,
    totalBytes: slot.totalBytes,
    cached: slot.cached,
    error: slot.error,
  };
}

export function getModelLoadSnapshot(): ModelLoadSnapshot {
  const models = [snapshotSlot(slots.chat), snapshotSlot(slots.embedding)];
  const phases = models.map((m) => m.phase);
  let overall: ModelLoadOverall = "idle";
  if (phases.some((p) => p === "error")) overall = "error";
  else if (phases.some((p) => p === "downloading")) overall = "downloading";
  else if (phases.some((p) => p === "checking")) overall = "checking";
  else if (phases.every((p) => p === "ready")) overall = "ready";
  else if (phases.some((p) => p === "ready" || p === "idle")) {
    // 片方が ready・もう片方が idle の過渡、または両方 idle
    overall = phases.every((p) => p === "idle") ? "idle" : "checking";
  }
  return { overall, models };
}

function applyProgress(slot: SlotRuntime, info: ProgressInfo) {
  if (info.status === "progress_total") {
    slot.phase = "downloading";
    slot.progress = typeof info.progress === "number" ? info.progress : slot.progress;
    slot.loadedBytes = typeof info.loaded === "number" ? info.loaded : slot.loadedBytes;
    slot.totalBytes = typeof info.total === "number" ? info.total : slot.totalBytes;
    return;
  }
  if (info.status === "progress") {
    slot.phase = "downloading";
    if (typeof info.progress === "number") slot.progress = info.progress;
    if (typeof info.loaded === "number") slot.loadedBytes = info.loaded;
    if (typeof info.total === "number") slot.totalBytes = info.total;
    return;
  }
  if (info.status === "initiate" || info.status === "download") {
    slot.phase = "downloading";
    return;
  }
  if (info.status === "ready") {
    slot.phase = "ready";
    slot.progress = 100;
  }
}

async function isCached(slot: SlotRuntime): Promise<boolean> {
  try {
    return await ModelRegistry.is_pipeline_cached(slot.task, slot.modelId, {
      dtype: slot.dtype as "q4" | "q8",
    });
  } catch {
    // レジストリ問い合わせ自体が失敗した場合は「未キャッシュ」扱いにし、
    // pipeline() 側の取得に任せる（オフライン時はそこで error になる）。
    return false;
  }
}

async function warmSlot(slot: SlotRuntime): Promise<void> {
  if (slot.phase === "ready") return;

  slot.phase = "checking";
  slot.error = null;
  const cached = await isCached(slot);
  slot.cached = cached;

  if (cached) {
    // ディスク上にあれば起動時ダウンロードは不要。メモリへのロードは従来通り遅延。
    slot.phase = "ready";
    slot.progress = 100;
    return;
  }

  slot.phase = "downloading";
  slot.progress = 0;
  const onProgress = (info: ProgressInfo) => applyProgress(slot, info);

  try {
    if (slot.key === "chat") {
      await getLocalGenerator(onProgress);
    } else {
      await getEmbedder(onProgress);
    }
    slot.phase = "ready";
    slot.progress = 100;
    slot.cached = true;
  } catch (err) {
    if (slot.key === "chat") clearLocalGeneratorCache();
    else clearEmbedderCache();
    slot.phase = "error";
    slot.error = err instanceof Error ? err.message : String(err);
  }
}

/**
 * 未キャッシュのローカルモデルを順にダウンロードする。冪等。
 * チャット（大きい方）→埋め込みの順で、同時ロードによるメモリ逼迫を避ける。
 */
export function ensureLocalModels(): Promise<void> {
  if (!warmPromise) {
    warmPromise = (async () => {
      await warmSlot(slots.chat);
      await warmSlot(slots.embedding);
    })().finally(() => {
      // error 時は再試行できるよう promise を手放す。ready 後も手放してよい（再入は即 return）。
      warmPromise = null;
    });
  }
  return warmPromise;
}

/** 失敗したスロットだけ idle に戻して ensure を再実行する。 */
export function retryFailedLocalModels(): Promise<void> {
  for (const slot of Object.values(slots)) {
    if (slot.phase === "error") {
      slot.phase = "idle";
      slot.progress = 0;
      slot.loadedBytes = null;
      slot.totalBytes = null;
      slot.error = null;
      slot.cached = null;
    }
  }
  warmPromise = null;
  return ensureLocalModels();
}

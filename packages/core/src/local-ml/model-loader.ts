import "./transformers-env";
import { ModelRegistry, type ProgressInfo } from "@huggingface/transformers";
import {
  clearLocalGeneratorCache,
  getLocalChatModel,
  getLocalGenerator,
  markLocalGeneratorUnavailable,
} from "./local-model";
import { DEFAULT_LOCAL_CHAT_MODEL } from "./local-chat-presets";
import {
  clearEmbedderCache,
  EMBEDDING_MODEL,
  getEmbedder,
  markEmbedderUnavailable,
} from "./embeddings";

// ローカルモデル（チャット生成・埋め込み）のディスクキャッシュ有無を見て、
// 未取得なら起動直後にダウンロード＋メモリロードを開始し、進捗をUIへ返すための状態機械。
// チャットモデルは設定（localChatModelPreset）で切替可能。切替時はスロットをリセットし、
// 未キャッシュなら再ダウンロードする。キャッシュ済みなら pipeline は呼ばず、
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
  // モジュール初期化時は既定プリセットで埋め、ensure / snapshot 時に設定と同期する
  // （テストの mock がまだ効いていない時点で getLocalChatModel を呼ばないため）。
  chat: {
    key: "chat",
    label: "ジャーナル抽出",
    modelId: DEFAULT_LOCAL_CHAT_MODEL.id,
    task: DEFAULT_LOCAL_CHAT_MODEL.task,
    dtype: DEFAULT_LOCAL_CHAT_MODEL.dtype,
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

/** 全体進捗が 100% になったあと pipeline が settle しない場合の待ち。 */
let stallAfterCompleteMs = 120_000;
/** ダウンロード中に進捗イベントが途絶えた場合の待ち。 */
let downloadIdleMs = 60_000;

/** テスト用: 停滞判定時間。本番コードからは呼ばない。 */
export function setModelLoaderStallTimeoutForTests(ms: number) {
  stallAfterCompleteMs = ms;
  downloadIdleMs = ms;
}

/**
 * 設定のチャットモデルがスロットと食い違っていれば、キャッシュを捨ててスロットを初期化する。
 * プリセット切替後の ensure / スナップショット取得のたびに呼ぶ。
 */
function syncChatSlotWithSettings(): void {
  const model = getLocalChatModel();
  const slot = slots.chat;
  if (slot.modelId === model.id && slot.task === model.task && slot.dtype === model.dtype) {
    return;
  }
  clearLocalGeneratorCache();
  slot.modelId = model.id;
  slot.task = model.task;
  slot.dtype = model.dtype;
  slot.phase = "idle";
  slot.progress = 0;
  slot.loadedBytes = null;
  slot.totalBytes = null;
  slot.cached = null;
  slot.error = null;
  warmPromise = null;
}

/** テスト用: モジュール内状態を初期化する。本番コードからは呼ばない。 */
export function resetModelLoaderStateForTests() {
  warmPromise = null;
  stallAfterCompleteMs = 120_000;
  downloadIdleMs = 60_000;
  const model = getLocalChatModel();
  slots.chat.modelId = model.id;
  slots.chat.task = model.task;
  slots.chat.dtype = model.dtype;
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
  syncChatSlotWithSettings();
  const models = [snapshotSlot(slots.chat), snapshotSlot(slots.embedding)];
  const phases = models.map((m) => m.phase);
  let overall: ModelLoadOverall = "idle";
  if (phases.some((p) => p === "error") || models.some((m) => m.error)) overall = "error";
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
  if (slot.phase === "error" || slot.phase === "ready") return;

  if (info.status === "progress_total") {
    slot.phase = "downloading";
    if (typeof info.progress === "number") slot.progress = info.progress;
    if (typeof info.loaded === "number") slot.loadedBytes = info.loaded;
    if (typeof info.total === "number") slot.totalBytes = info.total;
    return;
  }
  if (info.status === "progress") {
    slot.phase = "downloading";
    // LFM2.5 は onnx グラフ（~170KB）のあと数百MBの .onnx_data を取る。
    // 個別ファイルの 100% で全体の total/progress を潰すと、バナーが 100% のまま止まり、
    // 停止判定まで誤って発火する。
    if (slot.totalBytes !== null && typeof info.total === "number" && info.total < slot.totalBytes) {
      return;
    }
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
    // pipeline 側の取得に任せる（オフライン時はそこで error になる）。
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

  // Transformers.js は Node で return_path のとき、キャッシュ書き込み前に
  // progress:100 を出す。その直後 loadResourceFile が throw しても外側の
  // Promise が settle しないため、100% のままバナーが消えない。
  let settled = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const clearStallTimer = () => {
    if (stallTimer !== null) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        clearStallTimer();
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        clearStallTimer();
        resolve();
      };

      const onProgress = (info: ProgressInfo) => {
        applyProgress(slot, info);
        const overallPct =
          info.status === "progress_total" && typeof info.progress === "number" ? info.progress : null;
        clearStallTimer();
        if (overallPct !== null && overallPct >= 100) {
          stallTimer = setTimeout(() => {
            fail(
              new Error(
                `ローカルモデルの読み込みが完了しませんでした（${slot.modelId}）。キャッシュ先を確認して再試行してください。`,
              ),
            );
          }, stallAfterCompleteMs);
          return;
        }
        stallTimer = setTimeout(() => {
          fail(
            new Error(
              `ローカルモデルのダウンロードが中断しました（${slot.modelId}）。ネットワークを確認して再試行してください。`,
            ),
          );
        }, downloadIdleMs);
      };

      const load = slot.key === "chat" ? getLocalGenerator(onProgress) : getEmbedder(onProgress);
      void load.then(succeed, fail);
    });
    slot.phase = "ready";
    slot.progress = 100;
    slot.cached = true;
  } catch (err) {
    if (slot.key === "chat") markLocalGeneratorUnavailable();
    else markEmbedderUnavailable();
    slot.phase = "error";
    slot.error = err instanceof Error ? err.message : String(err);
  } finally {
    settled = true;
    clearStallTimer();
  }
}

/**
 * 未キャッシュのローカルモデルを順にダウンロードする。冪等。
 * チャット（大きい方）→埋め込みの順で、同時ロードによるメモリ逼迫を避ける。
 */
export function ensureLocalModels(): Promise<void> {
  syncChatSlotWithSettings();
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
  syncChatSlotWithSettings();
  for (const slot of Object.values(slots)) {
    if (slot.phase === "error") {
      slot.phase = "idle";
      slot.progress = 0;
      slot.loadedBytes = null;
      slot.totalBytes = null;
      slot.error = null;
      slot.cached = null;
      if (slot.key === "chat") clearLocalGeneratorCache();
      else clearEmbedderCache();
    }
  }
  warmPromise = null;
  return ensureLocalModels();
}

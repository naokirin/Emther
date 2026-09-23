import { beforeEach, describe, expect, it, vi } from "vitest";

const isPipelineCached = vi.fn();
const getLocalGenerator = vi.fn();
const getEmbedder = vi.fn();
const clearLocalGeneratorCache = vi.fn();
const clearEmbedderCache = vi.fn();
const markLocalGeneratorUnavailable = vi.fn();
const markEmbedderUnavailable = vi.fn();
const getLocalChatModel = vi.fn(() => ({ task: "text-generation" as const, id: "mock/chat", dtype: "q4" as const }));

vi.mock("@huggingface/transformers", () => ({
  ModelRegistry: {
    is_pipeline_cached: (...args: unknown[]) => isPipelineCached(...(args as [])),
  },
  env: { cacheDir: "" },
}));

vi.mock("./local-model", () => ({
  LOCAL_CHAT_MODEL: { task: "text-generation", id: "mock/chat", dtype: "q4" },
  getLocalChatModel: () => getLocalChatModel(),
  getLocalGenerator: (...args: unknown[]) => getLocalGenerator(...(args as [])),
  clearLocalGeneratorCache: () => clearLocalGeneratorCache(),
  markLocalGeneratorUnavailable: () => markLocalGeneratorUnavailable(),
}));

vi.mock("./embeddings", () => ({
  EMBEDDING_MODEL: { task: "feature-extraction", id: "mock/embed", dtype: "q8" },
  getEmbedder: (...args: unknown[]) => getEmbedder(...(args as [])),
  clearEmbedderCache: () => clearEmbedderCache(),
  markEmbedderUnavailable: () => markEmbedderUnavailable(),
}));

import {
  ensureLocalModels,
  getModelLoadSnapshot,
  resetModelLoaderStateForTests,
  retryFailedLocalModels,
  setModelLoaderStallTimeoutForTests,
} from "./model-loader";

describe("model-loader", () => {
  beforeEach(() => {
    isPipelineCached.mockReset();
    getLocalGenerator.mockReset();
    getEmbedder.mockReset();
    clearLocalGeneratorCache.mockReset();
    clearEmbedderCache.mockReset();
    markLocalGeneratorUnavailable.mockReset();
    markEmbedderUnavailable.mockReset();
    getLocalChatModel.mockReset();
    getLocalChatModel.mockReturnValue({ task: "text-generation", id: "mock/chat", dtype: "q4" });
    resetModelLoaderStateForTests();
  });

  it("両方キャッシュ済みなら pipeline を呼ばず ready になる", async () => {
    isPipelineCached.mockResolvedValue(true);
    await ensureLocalModels();
    const snap = getModelLoadSnapshot();
    expect(snap.overall).toBe("ready");
    expect(snap.models.every((m) => m.phase === "ready" && m.cached === true)).toBe(true);
    expect(getLocalGenerator).not.toHaveBeenCalled();
    expect(getEmbedder).not.toHaveBeenCalled();
  });

  it("未キャッシュなら progress_callback 付きで順にロードする", async () => {
    isPipelineCached.mockResolvedValue(false);
    getLocalGenerator.mockImplementation(async (cb?: (info: { status: string; progress?: number; loaded?: number; total?: number }) => void) => {
      cb?.({ status: "progress_total", progress: 40, loaded: 40, total: 100 });
      cb?.({ status: "ready" });
    });
    getEmbedder.mockImplementation(async (cb?: (info: { status: string; progress?: number; loaded?: number; total?: number }) => void) => {
      cb?.({ status: "progress_total", progress: 80, loaded: 80, total: 100 });
      cb?.({ status: "ready" });
    });

    await ensureLocalModels();

    const snap = getModelLoadSnapshot();
    expect(snap.overall).toBe("ready");
    expect(getLocalGenerator).toHaveBeenCalledTimes(1);
    expect(getEmbedder).toHaveBeenCalledTimes(1);
    // チャット→埋め込みの順
    expect(getLocalGenerator.mock.invocationCallOrder[0]).toBeLessThan(getEmbedder.mock.invocationCallOrder[0]);
    expect(getLocalGenerator.mock.calls[0][0]).toEqual(expect.any(Function));
  });

  it("ロード失敗時は error になり、キャッシュをクリアして再試行できる", async () => {
    isPipelineCached.mockResolvedValue(false);
    getLocalGenerator.mockRejectedValueOnce(new Error("network down"));
    getEmbedder.mockResolvedValue(undefined);

    await ensureLocalModels();
    expect(getModelLoadSnapshot().overall).toBe("error");
    expect(markLocalGeneratorUnavailable).toHaveBeenCalled();
    // チャット失敗でも埋め込みは続ける
    expect(getEmbedder).toHaveBeenCalled();

    isPipelineCached.mockResolvedValue(true);
    await retryFailedLocalModels();
    expect(getModelLoadSnapshot().overall).toBe("ready");
  });

  it("ensureLocalModels は同時呼び出しでも1系統だけ動く", async () => {
    isPipelineCached.mockResolvedValue(false);
    let resolveChat!: () => void;
    getLocalGenerator.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveChat = resolve;
        }),
    );
    getEmbedder.mockResolvedValue(undefined);

    const a = ensureLocalModels();
    const b = ensureLocalModels();
    await vi.waitFor(() => {
      expect(getLocalGenerator).toHaveBeenCalledTimes(1);
    });
    resolveChat();
    await Promise.all([a, b]);
    expect(getLocalGenerator).toHaveBeenCalledTimes(1);
  });

  it("チャットモデルIDが変わるとスロットをリセットして再確認する", async () => {
    isPipelineCached.mockResolvedValue(true);
    await ensureLocalModels();
    expect(getModelLoadSnapshot().models[0].modelId).toBe("mock/chat");
    expect(getModelLoadSnapshot().models[0].phase).toBe("ready");

    getLocalChatModel.mockReturnValue({
      task: "text-generation",
      id: "mock/chat-large",
      dtype: "q4",
    });

    const snap = getModelLoadSnapshot();
    expect(snap.models[0].modelId).toBe("mock/chat-large");
    expect(snap.models[0].phase).toBe("idle");
    expect(clearLocalGeneratorCache).toHaveBeenCalled();

    await ensureLocalModels();
    expect(getModelLoadSnapshot().models[0].phase).toBe("ready");
    expect(getModelLoadSnapshot().models[0].modelId).toBe("mock/chat-large");
  });

  it("進捗が途絶えたら error にする", async () => {
    setModelLoaderStallTimeoutForTests(40);
    isPipelineCached.mockResolvedValue(false);
    getLocalGenerator.mockImplementation((cb?: (info: { status: string; progress?: number; loaded?: number; total?: number }) => void) => {
      cb?.({ status: "progress", progress: 10, loaded: 10, total: 100 });
      return new Promise(() => {});
    });
    getEmbedder.mockResolvedValue(undefined);

    await ensureLocalModels();
    const snap = getModelLoadSnapshot();
    expect(snap.overall).toBe("error");
    expect(snap.models[0].phase).toBe("error");
    expect(snap.models[0].error).toMatch(/ダウンロードが中断/);
    expect(markLocalGeneratorUnavailable).toHaveBeenCalled();
  });

  it("全体 100% のまま pipeline が終わらないときは error にする", async () => {
    setModelLoaderStallTimeoutForTests(40);
    isPipelineCached.mockResolvedValue(false);
    getLocalGenerator.mockImplementation((cb?: (info: { status: string; progress?: number; loaded?: number; total?: number }) => void) => {
      cb?.({ status: "progress_total", progress: 100, loaded: 100, total: 100 });
      return new Promise(() => {});
    });
    getEmbedder.mockResolvedValue(undefined);

    await ensureLocalModels();
    const snap = getModelLoadSnapshot();
    expect(snap.overall).toBe("error");
    expect(snap.models[0].phase).toBe("error");
    expect(snap.models[0].error).toMatch(/読み込みが完了しませんでした/);
    expect(markLocalGeneratorUnavailable).toHaveBeenCalled();
    expect(getEmbedder).toHaveBeenCalled();
  });

  it("個別ファイルの 100% で全体バイト数を上書きしない", async () => {
    isPipelineCached.mockResolvedValue(false);
    let resolveChat!: () => void;
    getLocalGenerator.mockImplementation((cb?: (info: { status: string; progress?: number; loaded?: number; total?: number }) => void) => {
      cb?.({ status: "progress_total", progress: 0.02, loaded: 173643, total: 834045515 });
      cb?.({ status: "progress", progress: 100, loaded: 173643, total: 173643 });
      return new Promise<void>((resolve) => {
        resolveChat = resolve;
      });
    });
    getEmbedder.mockResolvedValue(undefined);

    const pending = ensureLocalModels();
    await vi.waitFor(() => {
      expect(getModelLoadSnapshot().models[0].totalBytes).toBe(834045515);
    });
    expect(getModelLoadSnapshot().models[0].progress).toBeCloseTo(0.02);
    expect(getModelLoadSnapshot().models[0].phase).toBe("downloading");
    resolveChat();
    await pending;
  });

  it("外部データダウンロード中は個別ファイル 100% で停止判定しない", async () => {
    setModelLoaderStallTimeoutForTests(40);
    isPipelineCached.mockResolvedValue(false);
    getLocalGenerator.mockImplementation((cb?: (info: { status: string; progress?: number; loaded?: number; total?: number }) => void) => {
      cb?.({ status: "progress_total", progress: 5, loaded: 173643, total: 834045515 });
      cb?.({ status: "progress", progress: 100, loaded: 173643, total: 173643 });
      return new Promise<void>((resolve) => {
        const tick = setInterval(() => {
          cb?.({ status: "progress_total", progress: 40, loaded: 300_000_000, total: 834045515 });
        }, 15);
        setTimeout(() => {
          clearInterval(tick);
          cb?.({ status: "progress_total", progress: 100, loaded: 834045515, total: 834045515 });
          cb?.({ status: "ready" });
          resolve();
        }, 80);
      });
    });
    getEmbedder.mockResolvedValue(undefined);

    await ensureLocalModels();
    expect(getModelLoadSnapshot().models[0].phase).toBe("ready");
    expect(markLocalGeneratorUnavailable).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const isPipelineCached = vi.fn();
const getLocalGenerator = vi.fn();
const getEmbedder = vi.fn();
const clearLocalGeneratorCache = vi.fn();
const clearEmbedderCache = vi.fn();

vi.mock("@huggingface/transformers", () => ({
  ModelRegistry: {
    is_pipeline_cached: (...args: unknown[]) => isPipelineCached(...args),
  },
}));

vi.mock("@/lib/local-model", () => ({
  LOCAL_CHAT_MODEL: { task: "text-generation", id: "mock/chat", dtype: "q4" },
  getLocalGenerator: (...args: unknown[]) => getLocalGenerator(...args),
  clearLocalGeneratorCache: () => clearLocalGeneratorCache(),
}));

vi.mock("@/lib/embeddings", () => ({
  EMBEDDING_MODEL: { task: "feature-extraction", id: "mock/embed", dtype: "q8" },
  getEmbedder: (...args: unknown[]) => getEmbedder(...args),
  clearEmbedderCache: () => clearEmbedderCache(),
}));

import {
  ensureLocalModels,
  getModelLoadSnapshot,
  resetModelLoaderStateForTests,
  retryFailedLocalModels,
} from "@/lib/model-loader";

describe("model-loader", () => {
  beforeEach(() => {
    resetModelLoaderStateForTests();
    isPipelineCached.mockReset();
    getLocalGenerator.mockReset();
    getEmbedder.mockReset();
    clearLocalGeneratorCache.mockReset();
    clearEmbedderCache.mockReset();
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
    expect(clearLocalGeneratorCache).toHaveBeenCalled();
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
});

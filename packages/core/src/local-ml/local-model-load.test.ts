import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "../test-helpers/store-env";

const pipeline = vi.fn();
vi.mock("@huggingface/transformers", () => ({
  pipeline: (...args: unknown[]) => pipeline(...args),
  env: { cacheDir: "" },
}));

describe("local-model load gating", () => {
  let dir: string;

  beforeEach(() => {
    dir = setupIsolatedStoreEnv();
    pipeline.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    teardownIsolatedStoreEnv(dir);
  });

  it("ロード中は runLocalChat が待たずに失敗する", async () => {
    pipeline.mockReturnValue(new Promise(() => {}));
    const { getLocalGenerator, runLocalChat } = await import("./local-model");
    void getLocalGenerator();
    await expect(runLocalChat([{ role: "user", content: "hi" }], 8)).rejects.toThrow(
      "local chat model is not ready",
    );
  });

  it("ロード完了後は generator を呼ぶ", async () => {
    const generate = vi.fn(async () => [{ generated_text: [{ role: "assistant", content: "ok" }] }]);
    pipeline.mockResolvedValue(generate);
    const { runLocalChat } = await import("./local-model");
    await expect(runLocalChat([{ role: "user", content: "hi" }], 8)).resolves.toBe("ok");
    expect(generate).toHaveBeenCalled();
  });

  it("ロード失敗後は clear するまで runLocalChat しない", async () => {
    pipeline.mockRejectedValueOnce(new Error("Unable to get model file path or buffer"));
    const { getLocalGenerator, runLocalChat, clearLocalGeneratorCache } = await import("./local-model");
    await expect(getLocalGenerator()).rejects.toThrow("Unable to get model file path or buffer");
    await expect(runLocalChat([{ role: "user", content: "hi" }], 8)).rejects.toThrow(
      "local chat model is not ready",
    );

    clearLocalGeneratorCache();
    const generate = vi.fn(async () => [{ generated_text: [{ role: "assistant", content: "ok" }] }]);
    pipeline.mockResolvedValue(generate);
    await expect(runLocalChat([{ role: "user", content: "hi" }], 8)).resolves.toBe("ok");
  });
});

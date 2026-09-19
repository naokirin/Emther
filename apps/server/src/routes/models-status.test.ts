import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureLocalModels = vi.fn(async () => undefined);
const retryFailedLocalModels = vi.fn(async () => undefined);
const getModelLoadSnapshot = vi.fn(() => ({
  overall: "ready" as const,
  models: [],
}));

vi.mock("@emther/core/model-loader", () => ({
  ensureLocalModels: () => ensureLocalModels(),
  retryFailedLocalModels: () => retryFailedLocalModels(),
  getModelLoadSnapshot: () => getModelLoadSnapshot(),
}));

describe("/api/models/status", () => {
  beforeEach(() => {
    ensureLocalModels.mockClear();
    retryFailedLocalModels.mockClear();
    getModelLoadSnapshot.mockClear();
  });

  it("GET は ensure を起動してスナップショットを返す", async () => {
    const { modelsStatusRoute } = await import("./models-status");
    const res = await modelsStatusRoute.request("/");
    expect(res.status).toBe(200);
    expect(ensureLocalModels).toHaveBeenCalled();
    expect(await res.json()).toEqual({ overall: "ready", models: [] });
  });

  it("POST は失敗スロットの再試行を起動する", async () => {
    const { modelsStatusRoute } = await import("./models-status");
    const res = await modelsStatusRoute.request("/", { method: "POST" });
    expect(res.status).toBe(200);
    expect(retryFailedLocalModels).toHaveBeenCalled();
  });
});

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
  vi.restoreAllMocks();
});

describe("POST /api/settings/data/reset", () => {
  it("confirm 欠如は 400", async () => {
    const archive = await import("@emther/core/state-archive");
    const exitSpy = vi.spyOn(archive, "scheduleProcessExit").mockImplementation(() => {});
    const { settingsDataResetRoute } = await import("./settings-data-reset");
    const res = await settingsDataResetRoute.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("RESET 確認でリセットし requiresRestart を返す", async () => {
    mkdirSync(process.env.EM_DATA_DIR!, { recursive: true });
    writeFileSync(join(process.env.EM_DATA_DIR!, "x.json"), "{}", "utf8");

    const archive = await import("@emther/core/state-archive");
    const exitSpy = vi.spyOn(archive, "scheduleProcessExit").mockImplementation(() => {});
    const { settingsDataResetRoute } = await import("./settings-data-reset");
    const res = await settingsDataResetRoute.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "RESET" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, requiresRestart: true });
    expect(exitSpy).toHaveBeenCalled();
  });
});

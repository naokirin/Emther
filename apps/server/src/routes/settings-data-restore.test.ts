import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

describe("POST /api/settings/data/restore", () => {
  it("file 欠如は 400", async () => {
    const archive = await import("@emther/core/state-archive");
    vi.spyOn(archive, "scheduleProcessExit").mockImplementation(() => {});
    const { settingsDataRestoreRoute } = await import("./settings-data-restore");
    const res = await settingsDataRestoreRoute.request("/", { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
  });

  it("有効なアーカイブで復元し requiresRestart を返す", async () => {
    mkdirSync(process.env.EM_DATA_DIR!, { recursive: true });
    mkdirSync(process.env.EM_SECURE_DATA_DIR!, { recursive: true });
    writeFileSync(join(process.env.EM_DATA_DIR!, "settings-rules.json"), '{"a":1}', "utf8");
    writeFileSync(
      join(process.env.EM_SECURE_DATA_DIR!, "people-directory.json"),
      JSON.stringify({ entries: [], counter: 0 }),
      "utf8",
    );

    const archive = await import("@emther/core/state-archive");
    const { archivePath, fileName } = archive.createBackupArchive();
    const exitSpy = vi.spyOn(archive, "scheduleProcessExit").mockImplementation(() => {});
    const { settingsDataRestoreRoute } = await import("./settings-data-restore");

    const form = new FormData();
    form.set("file", new File([readFileSync(archivePath)], fileName, { type: "application/gzip" }));
    const res = await settingsDataRestoreRoute.request("/", { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, requiresRestart: true });
    expect(exitSpy).toHaveBeenCalled();
  });
});

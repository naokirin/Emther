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

describe("POST /api/settings/data/backup", () => {
  // 隔離データは極小で単独実行は約1s。フルスイート＋他ジョブ並列時に壁時計が伸び
  // 既定5sを超えたことがあるため、余裕を見て15s（30sまでは伸ばさない）。
  it(
    "tar.gz をダウンロード用に返す",
    async () => {
      mkdirSync(process.env.EM_DATA_DIR!, { recursive: true });
      mkdirSync(process.env.EM_SECURE_DATA_DIR!, { recursive: true });
      writeFileSync(join(process.env.EM_DATA_DIR!, "x.json"), "{}", "utf8");
      writeFileSync(join(process.env.EM_SECURE_DATA_DIR!, "y.json"), "{}", "utf8");

      const { settingsDataBackupRoute } = await import("./settings-data-backup");
      const res = await settingsDataBackupRoute.request("/", { method: "POST" });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/gzip");
      expect(res.headers.get("Content-Disposition")).toMatch(/emther-state-.*\.tar\.gz/);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.byteLength).toBeGreaterThan(20);
    },
    15_000,
  );
});

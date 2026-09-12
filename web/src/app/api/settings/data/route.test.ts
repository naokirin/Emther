import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

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

      const route = await import("./backup/route");
      const res = await route.POST();
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/gzip");
      expect(res.headers.get("Content-Disposition")).toMatch(/emther-state-.*\.tar\.gz/);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.byteLength).toBeGreaterThan(20);
    },
    15_000,
  );
});

describe("POST /api/settings/data/reset", () => {
  it("confirm 欠如は 400", async () => {
    const archive = await import("@/lib/state-archive");
    const exitSpy = vi.spyOn(archive, "scheduleProcessExit").mockImplementation(() => {});
    const route = await import("./reset/route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}));
    expect(res.status).toBe(400);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("RESET 確認でリセットし requiresRestart を返す", async () => {
    mkdirSync(process.env.EM_DATA_DIR!, { recursive: true });
    writeFileSync(join(process.env.EM_DATA_DIR!, "x.json"), "{}", "utf8");

    const archive = await import("@/lib/state-archive");
    const exitSpy = vi.spyOn(archive, "scheduleProcessExit").mockImplementation(() => {});
    const route = await import("./reset/route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { confirm: "RESET" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, requiresRestart: true });
    expect(exitSpy).toHaveBeenCalled();
  });
});

describe("POST /api/settings/data/restore", () => {
  it("file 欠如は 400", async () => {
    const archive = await import("@/lib/state-archive");
    vi.spyOn(archive, "scheduleProcessExit").mockImplementation(() => {});
    const route = await import("./restore/route");
    const res = await route.POST(new Request("http://localhost/x", { method: "POST", body: new FormData() }));
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

    const archive = await import("@/lib/state-archive");
    const { archivePath, fileName } = archive.createBackupArchive();
    const exitSpy = vi.spyOn(archive, "scheduleProcessExit").mockImplementation(() => {});
    const route = await import("./restore/route");

    const form = new FormData();
    form.set("file", new File([readFileSync(archivePath)], fileName, { type: "application/gzip" }));
    const res = await route.POST(new Request("http://localhost/x", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, requiresRestart: true });
    expect(exitSpy).toHaveBeenCalled();
  });
});

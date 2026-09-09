import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadArchive() {
  return import("@/lib/state-archive");
}

describe("createBackupArchive / restoreFromArchive", () => {
  it("backup → restore で data と secure を往復できる", async () => {
    const dataDir = process.env.EM_DATA_DIR!;
    const secureDir = process.env.EM_SECURE_DATA_DIR!;
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(secureDir, { recursive: true });
    writeFileSync(join(dataDir, "settings-rules.json"), '{"teamWindowDays":42}', "utf8");
    writeFileSync(join(secureDir, "people-directory.json"), '{"entries":[],"counter":1}', "utf8");

    const { createBackupArchive, restoreFromArchive, resetAllState } = await loadArchive();
    const { archivePath, fileName } = createBackupArchive();
    expect(fileName).toMatch(/^emther-state-\d{8}-\d{6}\.tar.gz$/);
    expect(existsSync(archivePath)).toBe(true);

    resetAllState();
    expect(readdirSync(dataDir)).toEqual([]);
    expect(readdirSync(secureDir)).toEqual([]);

    restoreFromArchive(archivePath);
    expect(readFileSync(join(dataDir, "settings-rules.json"), "utf8")).toContain("42");
    expect(readFileSync(join(secureDir, "people-directory.json"), "utf8")).toContain('"counter":1');
  });

  it("旧ルート名 em-ai-team のアーカイブも復元できる", async () => {
    const dataDir = process.env.EM_DATA_DIR!;
    const secureDir = process.env.EM_SECURE_DATA_DIR!;
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(secureDir, { recursive: true });
    writeFileSync(join(dataDir, "marker.txt"), "keep-me", "utf8");

    const staging = join(dir, "legacy-staging");
    mkdirSync(join(staging, "em-ai-team", "data"), { recursive: true });
    mkdirSync(join(staging, "em-ai-team", "secure"), { recursive: true });
    writeFileSync(join(staging, "em-ai-team", "data", "legacy.txt"), "from-legacy", "utf8");
    writeFileSync(join(staging, "em-ai-team", "secure", "people.json"), "{}", "utf8");
    const legacyArchive = join(dir, "legacy.tar.gz");
    const tar = spawnSync("tar", ["-C", staging, "-czf", legacyArchive, "em-ai-team"], { encoding: "utf8" });
    expect(tar.status).toBe(0);

    const { restoreFromArchive } = await loadArchive();
    restoreFromArchive(legacyArchive);
    expect(readFileSync(join(dataDir, "legacy.txt"), "utf8")).toBe("from-legacy");
    expect(existsSync(join(dataDir, "marker.txt"))).toBe(false);
  });

  it("不正なアーカイブは拒否する", async () => {
    const bad = join(dir, "bad.tar.gz");
    const staging = join(dir, "bad-staging");
    mkdirSync(join(staging, "nope"), { recursive: true });
    writeFileSync(join(staging, "nope", "x.txt"), "x", "utf8");
    spawnSync("tar", ["-C", staging, "-czf", bad, "nope"]);

    const { restoreFromArchive } = await loadArchive();
    expect(() => restoreFromArchive(bad)).toThrow(/アーカイブ形式が不正/);
  });
});

describe("resetAllState", () => {
  it("data と secure の中身を空にする", async () => {
    const dataDir = process.env.EM_DATA_DIR!;
    const secureDir = process.env.EM_SECURE_DATA_DIR!;
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(secureDir, { recursive: true });
    writeFileSync(join(dataDir, "a.json"), "{}", "utf8");
    writeFileSync(join(secureDir, "b.json"), "{}", "utf8");

    const { resetAllState } = await loadArchive();
    resetAllState();
    expect(readdirSync(dataDir)).toEqual([]);
    expect(readdirSync(secureDir)).toEqual([]);
    expect(existsSync(dataDir)).toBe(true);
    expect(existsSync(secureDir)).toBe(true);
  });
});

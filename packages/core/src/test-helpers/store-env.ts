import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ストア群（issue-store, journal-store, org-context-store等）はimport時に
// loadJSON/getDb()でファイルからモジュール状態を読み込む「モジュールレベルの
// 副作用」を持つため、テストごとに(1)`.data`/secureディレクトリを差し替え、
// (2)vi.resetModules()でモジュールキャッシュを捨てて再import、という手順で
// 実データに触れずに毎回まっさらな状態からテストできるようにする。
export function setupIsolatedStoreEnv(): string {
  const dir = mkdtempSync(join(tmpdir(), "emther-test-"));
  process.env.EM_DATA_DIR = join(dir, "data");
  process.env.EM_SECURE_DATA_DIR = join(dir, "secure");
  process.env.EM_BACKUP_DIR = join(dir, "backups");
  return dir;
}

export function teardownIsolatedStoreEnv(dir: string): void {
  delete process.env.EM_DATA_DIR;
  delete process.env.EM_SECURE_DATA_DIR;
  delete process.env.EM_BACKUP_DIR;
  rmSync(dir, { recursive: true, force: true });
}

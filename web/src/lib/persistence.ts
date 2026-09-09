import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// 単一Node.jsプロセス・シングルユーザー前提のローカル永続化。
// デフォルト配置は XDG 準拠でリポジトリ外（docs/packaging.md）。
// EM_DATA_DIR / EM_SECURE_DATA_DIR はテスト・Docker・明示上書き用。
// 呼び出しのたびに process.env を読むのは、テストがモジュールをリセットせずに
// 環境変数だけを差し替えても正しく反映されるようにするため。

const APP_STATE_ROOT = join(homedir(), ".local", "state", "emther");
const PREVIOUS_APP_STATE_ROOT = join(homedir(), ".local", "state", "em-ai-team");

export function defaultDataDir(): string {
  return join(APP_STATE_ROOT, "data");
}

export function defaultSecureDataDir(): string {
  return join(APP_STATE_ROOT, "secure");
}

export function defaultBackupDir(): string {
  return join(APP_STATE_ROOT, "backups");
}

function previousDataDir(): string {
  return join(PREVIOUS_APP_STATE_ROOT, "data");
}

function previousSecureDataDir(): string {
  return join(PREVIOUS_APP_STATE_ROOT, "secure");
}

function legacyDataDir(): string {
  return process.env.EM_LEGACY_DATA_DIR || join(process.cwd(), ".data");
}

function legacySecureDataDir(): string {
  return process.env.EM_LEGACY_SECURE_DATA_DIR || join(homedir(), ".local", "state", "em-ai-team-secure");
}

function dirHasEntries(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/** 旧配置 → 現行パスへの一度きり移行。テストからも呼ぶ。 */
export function migrateLegacyLocations(options: {
  dataDir: string;
  secureDataDir: string;
  legacyDataDir: string;
  legacySecureDataDir: string;
}): { migratedData: boolean; migratedSecure: boolean } {
  return {
    migratedData: moveLegacyDirIfNeeded(options.legacyDataDir, options.dataDir),
    migratedSecure: moveLegacyDirIfNeeded(options.legacySecureDataDir, options.secureDataDir),
  };
}

function moveLegacyDirIfNeeded(from: string, to: string): boolean {
  if (!dirHasEntries(from)) return false;
  if (dirHasEntries(to)) return false;
  if (from === to) return false;

  try {
    mkdirSync(dirname(to), { recursive: true, mode: 0o755 });
    // 宛先が空ディレクトリとして先に作られている場合は除いてから rename する
    if (existsSync(to) && !dirHasEntries(to)) {
      rmSync(to, { recursive: true, force: true });
    }
    renameSync(from, to);
    return true;
  } catch {
    try {
      mkdirSync(to, { recursive: true, mode: 0o755 });
      cpSync(from, to, { recursive: true });
      writeFileSync(join(from, ".migrated-to"), `${to}\n`, "utf8");
      return true;
    } catch {
      return false;
    }
  }
}

let migratedThisProcess = false;

function ensureLegacyMigratedForDefaults(): void {
  if (migratedThisProcess) return;
  if (process.env.EM_DATA_DIR || process.env.EM_SECURE_DATA_DIR) {
    // 明示オーバーライド時は自動移行しない（テスト・Docker）
    migratedThisProcess = true;
    return;
  }
  migratedThisProcess = true;
  // 1) 旧プロダクト名 em-ai-team → emther
  migrateLegacyLocations({
    dataDir: defaultDataDir(),
    secureDataDir: defaultSecureDataDir(),
    legacyDataDir: previousDataDir(),
    legacySecureDataDir: previousSecureDataDir(),
  });
  // 2) さらに古い配置（cwd/.data・em-ai-team-secure）→ emther（まだ空なら）
  migrateLegacyLocations({
    dataDir: defaultDataDir(),
    secureDataDir: defaultSecureDataDir(),
    legacyDataDir: legacyDataDir(),
    legacySecureDataDir: legacySecureDataDir(),
  });
}

/** テスト用: プロセス内の移行済みフラグをリセットする */
export function resetMigrationGuardForTests(): void {
  migratedThisProcess = false;
}

function dataDir(): string {
  if (process.env.EM_DATA_DIR) return process.env.EM_DATA_DIR;
  ensureLegacyMigratedForDefaults();
  return defaultDataDir();
}

// 個人情報の分離: people-directory 専用。業務データ（data）とは別ディレクトリ木。
// プロジェクト／virtiofs 外に置き、(1) agent CLI の相対探索から切り離し、
// (2) chmod によるアクセス制御が実効的な場所にする。
function secureDataDir(): string {
  if (process.env.EM_SECURE_DATA_DIR) return process.env.EM_SECURE_DATA_DIR;
  ensureLegacyMigratedForDefaults();
  return defaultSecureDataDir();
}

function backupDir(): string {
  if (process.env.EM_BACKUP_DIR) return process.env.EM_BACKUP_DIR;
  return defaultBackupDir();
}

function ensureDir(dir: string, mode = 0o755): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode });
  }
}

/** バックアップ／復元／リセット用。絶対パスを返す（必要ならディレクトリを作成）。 */
export function getDataDir(): string {
  ensureDir(dataDir());
  return dataDir();
}

export function getSecureDataDir(): string {
  ensureDir(secureDataDir(), 0o700);
  return secureDataDir();
}

export function getBackupDir(): string {
  ensureDir(backupDir());
  return backupDir();
}

export function loadJSON<T>(filename: string, fallback: T): T {
  try {
    const path = join(dataDir(), filename);
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(filename: string, data: unknown): void {
  try {
    ensureDir(dataDir());
    writeFileSync(join(dataDir(), filename), JSON.stringify(data, null, 2), "utf8");
  } catch {
    // 永続化の失敗でアプリの動作自体は止めない（ベストエフォート）
  }
}

// SQLite（`@/lib/db`）等、loadJSON/saveJSONを使わない永続化先のためのパス解決。
export function dataFilePath(filename: string): string {
  ensureDir(dataDir());
  return join(dataDir(), filename);
}

export function loadSecureJSON<T>(filename: string, fallback: T): T {
  try {
    const path = join(secureDataDir(), filename);
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function saveSecureJSON(filename: string, data: unknown): void {
  try {
    ensureDir(secureDataDir(), 0o700);
    const path = join(secureDataDir(), filename);
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
    // writeFileSyncのmodeオプションはumaskの影響を受け、かつ既存ファイルの権限は
    // 変更しないため、書き込みのたびに明示的にchmodして0600を保証する。
    chmodSync(path, 0o600);
  } catch {
    // 永続化の失敗でアプリの動作自体は止めない（ベストエフォート）
  }
}

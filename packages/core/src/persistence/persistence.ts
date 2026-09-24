import {
  chmodSync,
  copyFileSync,
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
// デフォルト配置は XDG 準拠でリポジトリ外。
// EM_DATA_DIR / EM_SECURE_DATA_DIR はテスト・Docker・明示上書き用。
// 呼び出しのたびに process.env を読むのは、テストがモジュールをリセットせずに
// 環境変数だけを差し替えても正しく反映されるようにするため。
// JSON 書き込みは「.bak 退避 → .tmp へ書いて rename」で行い、OOM／強制終了で
// 途中切れの不完全 JSON が本体になる事故と、その後の空 fallback→persist による
// 二次消失を抑える（Knowledge/Issue 等の蓄積データを守る）。

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

function readJsonFile<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function loadJsonWithBackup<T>(dir: string, filename: string, fallback: T): T {
  const primary = readJsonFile<T>(join(dir, filename));
  if (primary !== undefined) return primary;
  // 本体が無い／壊れているときは直前の .bak を試す（空 fallback→再保存で消すのを防ぐ）。
  const backup = readJsonFile<T>(join(dir, `${filename}.bak`));
  if (backup !== undefined) return backup;
  return fallback;
}

/**
 * 同一ディレクトリ内で原子的に JSON を差し替える。
 * 1) 既存の健全な本体があれば .bak へコピー
 * 2) .tmp に書いてから rename（途中 kill でも旧本体が残る）
 */
function atomicWriteJson(dir: string, filename: string, data: unknown, fileMode?: number): void {
  ensureDir(dir, fileMode === 0o600 ? 0o700 : 0o755);
  const path = join(dir, filename);
  const bakPath = join(dir, `${filename}.bak`);
  const tmpPath = join(dir, `${filename}.tmp`);
  const payload = JSON.stringify(data, null, 2);

  if (existsSync(path) && readJsonFile<unknown>(path) !== undefined) {
    try {
      copyFileSync(path, bakPath);
      if (fileMode !== undefined) chmodSync(bakPath, fileMode);
    } catch {
      // バックアップ失敗でも本体の保存は試みる
    }
  }

  writeFileSync(tmpPath, payload, "utf8");
  if (fileMode !== undefined) chmodSync(tmpPath, fileMode);
  renameSync(tmpPath, path);
  if (fileMode !== undefined) chmodSync(path, fileMode);
}

/** ディスク上の現行（または .bak）を覗く。空上書きガード用。 */
export function peekJSON<T>(filename: string): T | undefined {
  try {
    const dir = dataDir();
    return readJsonFile<T>(join(dir, filename)) ?? readJsonFile<T>(join(dir, `${filename}.bak`));
  } catch {
    return undefined;
  }
}

export function peekSecureJSON<T>(filename: string): T | undefined {
  try {
    const dir = secureDataDir();
    return readJsonFile<T>(join(dir, filename)) ?? readJsonFile<T>(join(dir, `${filename}.bak`));
  } catch {
    return undefined;
  }
}

export type SaveJsonOptions = {
  /** true のとき、配列が空でも既存の非空配列を上書きしてよい（意図的クリア）。 */
  allowEmpty?: boolean;
};

function shouldRefuseEmptyArrayOverwrite(filename: string, data: unknown, allowEmpty: boolean, peek: <T>(f: string) => T | undefined): boolean {
  if (allowEmpty) return false;
  if (!Array.isArray(data) || data.length > 0) return false;
  const onDisk = peek<unknown>(filename);
  return Array.isArray(onDisk) && onDisk.length > 0;
}

export function loadJSON<T>(filename: string, fallback: T): T {
  try {
    return loadJsonWithBackup(dataDir(), filename, fallback);
  } catch {
    return fallback;
  }
}

export function saveJSON(filename: string, data: unknown, opts: SaveJsonOptions = {}): void {
  try {
    if (shouldRefuseEmptyArrayOverwrite(filename, data, opts.allowEmpty === true, peekJSON)) {
      console.error(`[persistence] refused to overwrite non-empty ${filename} with empty array`);
      return;
    }
    atomicWriteJson(dataDir(), filename, data);
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
    return loadJsonWithBackup(secureDataDir(), filename, fallback);
  } catch {
    return fallback;
  }
}

export function saveSecureJSON(filename: string, data: unknown, opts: SaveJsonOptions = {}): void {
  try {
    if (shouldRefuseEmptyArrayOverwrite(filename, data, opts.allowEmpty === true, peekSecureJSON)) {
      console.error(`[persistence] refused to overwrite non-empty ${filename} with empty array`);
      return;
    }
    // people-directory 等は所有者のみ読み書き（0600）。
    atomicWriteJson(secureDataDir(), filename, data, 0o600);
  } catch {
    // 永続化の失敗でアプリの動作自体は止めない（ベストエフォート）
  }
}

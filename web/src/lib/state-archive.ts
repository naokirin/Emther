import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { killLiveAgentProcesses } from "@/lib/agent-runtime";
import { closeDb } from "@/lib/db";
import { getBackupDir, getDataDir, getSecureDataDir } from "@/lib/persistence";

// CLI `emther backup` / `emther restore` と同形式の state アーカイブ。
// ルートは emther/{data,secure,BACKUP_META.txt}。復元時は旧 em-ai-team/ も受理する。
// 追加 npm 依存を避け、ホストの tar を呼ぶ（ランチャーと同じ手段）。

export type BackupArchiveResult = {
  archivePath: string;
  fileName: string;
};

function stampNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function emptyDirContents(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  for (const name of readdirSync(dir)) {
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}

function runTar(args: string[]): void {
  const result = spawnSync("tar", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim() || `exit ${result.status}`;
    throw new Error(`tar に失敗しました: ${detail}`);
  }
}

/** 復元／リセット前に DB と agent 子プロセスを手放す。 */
export function prepareForDestructiveStateChange(): void {
  killLiveAgentProcesses();
  closeDb();
}

/**
 * data + secure を tar.gz に固める（個人情報を含む）。
 * 出力先は EM_BACKUP_DIR（既定 ~/.local/state/emther/backups）。
 */
export function createBackupArchive(): BackupArchiveResult {
  const dataDir = getDataDir();
  const secureDir = getSecureDataDir();
  const backupDir = getBackupDir();
  const stamp = stampNow();
  const fileName = `emther-state-${stamp}.tar.gz`;
  const archivePath = join(backupDir, fileName);

  const tmp = mkdtempSync(join(tmpdir(), "emther-backup-"));
  try {
    const root = join(tmp, "emther");
    mkdirSync(join(root, "data"), { recursive: true });
    mkdirSync(join(root, "secure"), { recursive: true });
    if (existsSync(dataDir)) {
      cpSync(dataDir, join(root, "data"), { recursive: true });
    }
    if (existsSync(secureDir)) {
      cpSync(secureDir, join(root, "secure"), { recursive: true });
    }
    writeFileSync(
      join(root, "BACKUP_META.txt"),
      `${stamp}\ndata=${dataDir}\nsecure=${secureDir}\n`,
      "utf8",
    );
    runTar(["-C", tmp, "-czf", archivePath, "emther"]);
    try {
      chmodSync(archivePath, 0o600);
    } catch {
      // ベストエフォート
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  return { archivePath, fileName };
}

function detectArchiveRoot(extracted: string): "emther" | "em-ai-team" {
  if (existsSync(join(extracted, "emther", "data")) && existsSync(join(extracted, "emther", "secure"))) {
    return "emther";
  }
  if (
    existsSync(join(extracted, "em-ai-team", "data")) &&
    existsSync(join(extracted, "em-ai-team", "secure"))
  ) {
    return "em-ai-team";
  }
  throw new Error(
    "アーカイブ形式が不正です（emther/{data,secure} または旧 em-ai-team/{data,secure} が必要）",
  );
}

function hardenSecureDir(secureDir: string): void {
  try {
    chmodSync(secureDir, 0o700);
  } catch {
    // ignore
  }
  if (!existsSync(secureDir)) return;
  for (const name of readdirSync(secureDir)) {
    try {
      chmodSync(join(secureDir, name), 0o600);
    } catch {
      // ディレクトリ等は無視
    }
  }
}

/**
 * アーカイブで data/secure を全置換する。呼び出し前に prepareForDestructiveStateChange() を推奨。
 * 既存内容は空にしてからコピーする（部分混在を避ける）。
 */
export function restoreFromArchive(archivePath: string): void {
  if (!existsSync(archivePath)) {
    throw new Error(`ファイルがありません: ${archivePath}`);
  }
  if (!basename(archivePath).endsWith(".tar.gz") && !basename(archivePath).endsWith(".tgz")) {
    throw new Error("バックアップは .tar.gz である必要があります");
  }

  prepareForDestructiveStateChange();

  const dataDir = getDataDir();
  const secureDir = getSecureDataDir();
  const tmp = mkdtempSync(join(tmpdir(), "emther-restore-"));
  try {
    runTar(["-C", tmp, "-xzf", archivePath]);
    const rootName = detectArchiveRoot(tmp);
    const srcData = join(tmp, rootName, "data");
    const srcSecure = join(tmp, rootName, "secure");

    emptyDirContents(dataDir);
    emptyDirContents(secureDir);
    cpSync(srcData, dataDir, { recursive: true });
    cpSync(srcSecure, secureDir, { recursive: true });
    hardenSecureDir(secureDir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** data + secure の中身を全削除する（ディレクトリ自体は残す）。 */
export function resetAllState(): void {
  prepareForDestructiveStateChange();
  emptyDirContents(getDataDir());
  emptyDirContents(getSecureDataDir());
  try {
    chmodSync(getSecureDataDir(), 0o700);
  } catch {
    // ignore
  }
}

/** レスポンス送信後にプロセスを止める（テストでは mock する）。 */
export function scheduleProcessExit(delayMs = 500): void {
  setTimeout(() => {
    process.exit(0);
  }, delayMs);
}

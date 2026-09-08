import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// MVPの永続化: `.data/*.json`へのベタ書き。複数ワーカー/同時書き込みは想定しない
// （このアプリは単一Node.jsプロセスのシングルユーザー利用が前提）。
// Core Context DB / Daily Logs DBとしての本実装（v5設計書）はまだ先の話で、
// これはあくまで「プロセス再起動でデータが消える」問題への最小限の対処。
//
// EM_DATA_DIR/EM_SECURE_DATA_DIRは自動テスト専用のオーバーライド（テストが実データの
// `.data/`・SECURE_DATA_DIRへ書き込んでしまわないよう、一時ディレクトリへ差し替えるため）。
// 呼び出しのたびに`process.env`を読むのは、テストがモジュールをリセットせずに
// 環境変数だけを差し替えても正しく反映されるようにするため。
function dataDir(): string {
  return process.env.EM_DATA_DIR || join(process.cwd(), ".data");
}

// 個人情報の分離（ユーザー指摘対応）: people-directory.json専用の、プロジェクト
// ディレクトリ（`.data/`）とは物理的に別のディレクトリ木。このリポジトリは
// virtiofs（Lima VM共有フォルダ）上にあり、そこではUnixパーミッションが実効的に
// 機能しないことを実機検証済みのため、「プロジェクトの外・ホームディレクトリ直下の
// 非virtiofsな場所」に置くことで、(1) cursor-agentのworkspace探索・相対パス推測から
// 完全に切り離し、(2) 将来的にOSユーザー分離（chmodによるアクセス制御）を追加する場合に
// 実効性のある場所にしている。
function secureDataDir(): string {
  return process.env.EM_SECURE_DATA_DIR || join(homedir(), ".local", "state", "em-ai-team-secure");
}

function ensureDir(dir: string, mode = 0o755): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode });
  }
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

// SQLite（`@/lib/db`）等、loadJSON/saveJSONを使わない永続化先が`.data/`配下に
// ファイルを置きたい場合のためのパス解決ヘルパー。
export function dataFilePath(filename: string): string {
  ensureDir(dataDir());
  return join(dataDir(), filename);
}

// 個人情報の分離（ユーザー指摘対応）: people-directory.json専用。SECURE_DATA_DIR
// （プロジェクトディレクトリの外）へ、所有者のみ読み書き可能な権限（0700/0600）で保存する。
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

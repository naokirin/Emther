import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// MVPの永続化: `.data/*.json`へのベタ書き。複数ワーカー/同時書き込みは想定しない
// （このアプリは単一Node.jsプロセスのシングルユーザー利用が前提）。
// Core Context DB / Daily Logs DBとしての本実装（v5設計書）はまだ先の話で、
// これはあくまで「プロセス再起動でデータが消える」問題への最小限の対処。
const DATA_DIR = join(process.cwd(), ".data");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadJSON<T>(filename: string, fallback: T): T {
  try {
    const path = join(DATA_DIR, filename);
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(filename: string, data: unknown): void {
  try {
    ensureDir();
    writeFileSync(join(DATA_DIR, filename), JSON.stringify(data, null, 2), "utf8");
  } catch {
    // 永続化の失敗でアプリの動作自体は止めない（ベストエフォート）
  }
}

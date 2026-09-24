import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";

// dist/server.js から見て隣の client/（apps/web の vite build 出力）があれば
// 静的配信を有効化する。dev（tsx watch）時はこのディレクトリが無いため、
// vite 側プロキシ経由の API 専用サーバーとして動く。
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = process.env.EM_CLIENT_DIR ?? path.join(here, "client");
const app = createApp({ clientDir: existsSync(clientDir) ? clientDir : undefined });

const lifeLogPath = process.env.EM_SERVER_LIFE_LOG?.trim() || "/tmp/emther-server-life.log";

function lifeLog(event: string, detail?: unknown): void {
  const rss = process.memoryUsage();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    pid: process.pid,
    event,
    rssMb: Math.round(rss.rss / 1024 / 1024),
    heapMb: Math.round(rss.heapUsed / 1024 / 1024),
    detail:
      detail instanceof Error
        ? { name: detail.name, message: detail.message, stack: detail.stack }
        : detail,
  });
  try {
    appendFileSync(lifeLogPath, `${line}\n`);
  } catch {
    // 診断用。書けなくても本処理は継続。
  }
  if (event !== "boot") {
    console.error(`[emther-server] ${event}`, detail ?? "");
  }
}

// ローカル ML モデル読み込み中の例外がリクエストの await チェーン外で発生し、
// app.onError では拾えずプロセスごとクラッシュしうる（例: @huggingface/transformers）。
// 単一プロセス配信では API だけでなく静的 UI も道連れになるため、ログを残して
// プロセスは継続させる（当該リクエストはタイムアウトするのみ）。
process.on("uncaughtException", (err) => {
  lifeLog("uncaughtException", err);
});
process.on("unhandledRejection", (reason) => {
  lifeLog("unhandledRejection", reason);
});
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(sig, () => {
    lifeLog(sig);
    // ハンドラを付けるとデフォルト終了が消えるので、記録後に明示終了する。
    process.exit(sig === "SIGINT" ? 130 : 143);
  });
}
process.on("beforeExit", (code) => {
  lifeLog("beforeExit", { code });
});
process.on("exit", (code) => {
  lifeLog("exit", { code });
});
lifeLog("boot");

// 単一プロセス配信では scripts/emther が渡す PORT/HOSTNAME を優先する。
// 並走 dev では HONO_PORT/HONO_HOST で別ポート常駐。
const port = Number(process.env.PORT ?? process.env.HONO_PORT ?? 8787);
const hostname = process.env.HOSTNAME ?? process.env.HONO_HOST ?? "127.0.0.1";

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[emther-server] listening on http://${info.address}:${info.port}`);
});

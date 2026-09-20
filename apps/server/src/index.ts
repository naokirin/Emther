import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";

// docs/2nd_architecture/plan.md フェーズ4.3: dist/server.js から見て隣の
// client/ ディレクトリ（apps/web の vite build 出力。フェーズ4.4のパッケージング
// で server.js と同じ階層に配置する想定）があれば静的配信を有効化する。
// dev（tsx watch）実行時はこのディレクトリが存在しないため、これまで通り
// vite dev 側のプロキシ経由の API 専用サーバーとして動く。
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = process.env.EM_CLIENT_DIR ?? path.join(here, "client");
const app = createApp({ clientDir: existsSync(clientDir) ? clientDir : undefined });

// docs/2nd_architecture/plan.md フェーズ2.7・リスクレジスタ: フェーズ2.5バッチ6の
// 手動smoke testで、ローカルMLモデル読み込み中の例外がリクエストのawaitチェーンの
// 外（ライブラリ内部の非同期処理）で発生し、app.onError（app.ts）では拾えずNode
// プロセスごとクラッシュする事象を2026-09-19に実機再現・確認した
// （@huggingface/transformersのloadResourceFileが投げる例外。モデル未ダウンロード
// 環境で発生。詳細はplan.md参照）。単一プロセス配信になるフェーズ4以降はこの種の
// クラッシュがAPIだけでなく静的UI配信も道連れにするため、ログを残してプロセスは
// 継続させる（デフォルトの即クラッシュより可用性が高い。当該リクエストのクライアント
// は応答なしでタイムアウトするのみに留まる）。
process.on("uncaughtException", (err) => {
  console.error("[emther-server] uncaughtException（プロセスは継続します）", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[emther-server] unhandledRejection（プロセスは継続します）", reason);
});

// フェーズ2〜3（Hono並走・dev並走）の間は HONO_PORT/HONO_HOST で別ポート常駐。
// フェーズ4（単一プロセス配信）では scripts/emther が渡す PORT/HOSTNAME
// （Next standalone server.js と同じ命名。docs/2nd_architecture/plan.md 4.4）を
// 優先する。
const port = Number(process.env.PORT ?? process.env.HONO_PORT ?? 8787);
const hostname = process.env.HOSTNAME ?? process.env.HONO_HOST ?? "127.0.0.1";

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[emther-server] listening on http://${info.address}:${info.port}`);
});

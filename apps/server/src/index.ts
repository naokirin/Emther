import { serve } from "@hono/node-server";
import { app } from "./app";

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

// フェーズ2（Hono並走）の間はNextとは別ポートで常駐する。
// フェーズ4で単一プロセス配信に切り替える際、PORT/HOSTの扱いを
// scripts/emther（Next側）と統合する（docs/2nd_architecture/plan.md 4.3〜4.4）。
const port = Number(process.env.HONO_PORT ?? 8787);
const hostname = process.env.HONO_HOST ?? "127.0.0.1";

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[emther-server] listening on http://${info.address}:${info.port}`);
});

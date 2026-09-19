import { serve } from "@hono/node-server";
import { app } from "./app";

// フェーズ2（Hono並走）の間はNextとは別ポートで常駐する。
// フェーズ4で単一プロセス配信に切り替える際、PORT/HOSTの扱いを
// scripts/emther（Next側）と統合する（docs/2nd_architecture/plan.md 4.3〜4.4）。
const port = Number(process.env.HONO_PORT ?? 8787);
const hostname = process.env.HONO_HOST ?? "127.0.0.1";

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[emther-server] listening on http://${info.address}:${info.port}`);
});

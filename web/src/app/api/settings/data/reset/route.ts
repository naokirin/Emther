// docs/2nd_architecture/plan.md フェーズ4.3a: 実処理は apps/server/src/routes/settings-data-reset.ts へ移設済み。
import { proxyToHono } from "@/lib/hono-proxy";

export const POST = proxyToHono;

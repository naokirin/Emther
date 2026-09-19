// docs/2nd_architecture/plan.md フェーズ2.3: 実処理は apps/server/src/routes/vitals.ts へ移設済み。
import { proxyToHono } from "@/lib/hono-proxy";

export const GET = proxyToHono;

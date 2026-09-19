// docs/2nd_architecture/plan.md フェーズ2.3: 実処理は apps/server/src/routes/knowledge-events.ts へ移設済み。
import { proxyToHono } from "@/lib/hono-proxy";

export const GET = proxyToHono;

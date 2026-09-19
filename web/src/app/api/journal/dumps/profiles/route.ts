// docs/2nd_architecture/plan.md フェーズ2.5: 実処理は apps/server/src/routes/journal-dumps.ts へ移設済み。
import { proxyToHono } from "@/lib/hono-proxy";

export const GET = proxyToHono;
export const POST = proxyToHono;
export const DELETE = proxyToHono;

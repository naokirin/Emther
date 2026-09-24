import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

// 単一プロセス配信で Hono が
// `dist/client`（apps/web の vite build 出力）の静的配信を兼ねる
// SPA のクライアントサイドルーティング（React Router）のため、静的ファイルに
// 一致しない GET リクエストは index.html にフォールバックする。ただし `/api/*`
// はフォールバック対象から除外し、未知の API パスは JSON 404 のままにする
export function mountStaticClient(app: Hono, clientDir: string) {
  app.use("*", serveStatic({ root: clientDir }));
  app.notFound((c) => {
    if (c.req.method === "GET" && !c.req.path.startsWith("/api")) {
      const indexPath = path.join(clientDir, "index.html");
      if (existsSync(indexPath)) {
        return c.html(readFileSync(indexPath, "utf-8"));
      }
    }
    return c.json({ error: "not_found" }, 404);
  });
}

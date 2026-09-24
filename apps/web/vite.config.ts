import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev時は /api を apps/server（Hono）へプロキシする。ポート/接続先は HONO_PORT / HONO_SERVER_URL に揃える。
const honoServerUrl = process.env.HONO_SERVER_URL ?? `http://127.0.0.1:${process.env.HONO_PORT ?? "8787"}`;

export default defineConfig({
  plugins: [react()],
  // 配布物レイアウトは dist/client（`apps/server` が単一プロセスで静的配信する際の既定の探索先）。
  build: {
    outDir: "dist/client",
  },
  server: {
    proxy: {
      "/api": {
        target: honoServerUrl,
        changeOrigin: true,
      },
    },
  },
});

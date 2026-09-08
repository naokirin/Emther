import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // これらのストアはimport時にloadJSON/getDb()を呼びファイル状態を読み込むため、
    // テストごとに新しいプロセスで実行してモジュールキャッシュ・環境変数の
    // 影響が他テストファイルへ漏れないようにする。
    isolate: true,
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/local-model.ts", "src/lib/embeddings.ts", "src/lib/agent-runtime.ts"],
    },
  },
});

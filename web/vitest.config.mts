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
    // このマシンのCPUコア数（4）を大きく超えて一斉にforkすると、依存解決が稀に
    // レースしてalias解決に失敗することを実機で確認した（"Cannot find package '@/...'"）。
    // 同時起動数をコア数程度に抑えて安定させる。
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/local-model.ts", "src/lib/embeddings.ts", "src/lib/agent-runtime.ts"],
    },
  },
});

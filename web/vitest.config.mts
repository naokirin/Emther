import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@core": fileURLToPath(new URL("../packages/core/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // フック/コンポーネントのテスト（*.test.tsx）はファイル先頭の
    // `// @vitest-environment jsdom` プラグマでjsdomへ個別に切り替える
    // （それ以外の大多数のテストはDOM不要なので既定のnode環境のまま高速に保つ）。
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    // これらのストアはimport時にloadJSON/getDb()を呼びファイル状態を読み込むため、
    // テストごとに新しいプロセスで実行してモジュールキャッシュ・環境変数の
    // 影響が他テストファイルへ漏れないようにする。
    isolate: true,
    pool: "forks",
    // このマシンのCPUコア数（4）を大きく超えて一斉にforkすると、依存解決が稀に
    // レースしてalias解決に失敗することを実機で確認した（"Cannot find package '@/...'"）。
    // 同時起動数をコア数程度に抑えて安定させる。
    maxWorkers: 4,
    // 既定の5000msだと、実際の辞書・形態素解析（name-candidate-detect、初回ロードが重い）を
    // 使うテストが、フルスイート実行時のCPU競合下で稀にタイムアウトすることを確認した。
    // 個々のテストをモックで誤魔化すより、実装の正しさを保ったまま余裕を持たせる。
    testTimeout: 10000,
    // src/lib の大半は packages/core へ移設済み（docs/2nd_architecture/plan.md フェーズ1）。
    // ここには "@/lib" のうちNext依存で core 化できなかった残り（hooks等）だけが残る。
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/lib/**/*.tsx"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/**/*.test.tsx"],
    },
  },
});

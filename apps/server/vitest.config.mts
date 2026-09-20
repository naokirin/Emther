import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    isolate: true,
    pool: "forks",
    maxWorkers: 4,
    testTimeout: 10000,
    env: {
      EM_TRANSFORMERS_CACHE_DIR: join(tmpdir(), "emther-test-transformers-cache"),
    },
  },
});

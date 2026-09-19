import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    isolate: true,
    pool: "forks",
    maxWorkers: 4,
    testTimeout: 10000,
  },
});

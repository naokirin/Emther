import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// web/vitest.setup.ts と同じ理由（globals: true を使っていないため自動検出されない）。
afterEach(() => {
  cleanup();
});

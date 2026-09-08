import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("GET /api/timeline", () => {
  it("空の場合は空配列を返す", async () => {
    const route = await import("./route");
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });

  it("Issue作成などの変更履歴を実名復元済みで返す", async () => {
    const issueStore = await import("@/lib/issue-store");
    await issueStore.createIssue("障害対応");
    const route = await import("./route");
    const res = await route.GET();
    const json = await res.json();
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].entityLabel).toBe("障害対応");
  });
});

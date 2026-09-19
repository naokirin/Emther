import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("GET /api/knowledge/events", () => {
  it("entityType/entityIdが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x"));
    expect(res.status).toBe(400);
  });

  it("entityTypeが不正な値なら400", async () => {
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x?entityType=journal&entityId=x"));
    expect(res.status).toBe(400);
  });

  it("指定したentityの変更履歴を返す", async () => {
    const issueStore = await import("@core/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.GET(new Request(`http://localhost/x?entityType=issue&entityId=${issue.id}`));
    const json = await res.json();
    expect(json.events).toHaveLength(1);
    expect(json.events[0].text).toContain("提案を作成");
  });
});

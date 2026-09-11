import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/embeddings", () => ({
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

describe("POST /api/issues/[id]/archive", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("archivedを省略すると現在値を反転する（トグル）", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");

    const toggled = await route.POST(jsonRequest(`http://localhost/x`, "POST", {}), routeCtx({ id: issue.id }));
    expect((await toggled.json()).issue.archived).toBe(true);

    const toggledBack = await route.POST(jsonRequest(`http://localhost/x`, "POST", {}), routeCtx({ id: issue.id }));
    expect((await toggledBack.json()).issue.archived).toBe(false);
  });

  it("archivedを明示的に指定できる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { archived: true }), routeCtx({ id: issue.id }));
    expect((await res.json()).issue.archived).toBe(true);
  });
});

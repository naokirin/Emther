import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@/lib/test-helpers/api-route";

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

describe("POST /api/issues/[id]/log", () => {
  it("textが無ければ400", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: issue.id }));
    expect(res.status).toBe(400);
  });

  it("存在しないIssueは404", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { text: "ログ" }), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("追加できる（201）", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { text: "1on1で状況確認した" }), routeCtx({ id: issue.id }));
    expect(res.status).toBe(201);
    expect((await res.json()).issue.logEntries[0].text).toBe("1on1で状況確認した");
  });
});

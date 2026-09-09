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

describe("POST /api/issues/[id]/action-items/[itemId]/promote", () => {
  it("Action Itemを子Issueへ昇格できる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("親");
    const withItem = await issueStore.addActionItem(issue.id, "切り出す介入");
    const itemId = withItem!.actionItems[0].id;
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest(`http://localhost/api/issues/${issue.id}/action-items/${itemId}/promote`, "POST", {}),
      routeCtx({ id: issue.id, itemId }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.child.parentId).toBe(issue.id);
    expect(json.child.title).toBe("切り出す介入");
    expect(json.issue.actionItems[0].done).toBe(true);
  });

  it("子Issueからは400", async () => {
    const issueStore = await import("@/lib/issue-store");
    const parent = await issueStore.createIssue("親");
    const child = await issueStore.createIssue("子", undefined, undefined, parent.id);
    const withItem = await issueStore.addActionItem(child.id, "一手");
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", {}),
      routeCtx({ id: child.id, itemId: withItem!.actionItems[0].id }),
    );
    expect(res.status).toBe(400);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { routeCtx } from "@/lib/test-helpers/api-route";

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

describe("PATCH /api/issues/[id]/action-items/[itemId]", () => {
  it("完了状態をトグルできる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const withItem = await issueStore.addActionItem(issue.id, "やること");
    const itemId = withItem!.actionItems[0].id;

    const route = await import("./route");
    const res = await route.PATCH(new Request("http://localhost/x", { method: "PATCH" }), routeCtx({ id: issue.id, itemId }));
    expect(res.status).toBe(200);
    expect((await res.json()).issue.actionItems[0].done).toBe(true);
  });

  it("asNext:trueで次の一手に繰り上げできる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    await issueStore.addActionItem(issue.id, "先");
    const withSecond = await issueStore.addActionItem(issue.id, "後");
    const secondId = withSecond!.actionItems[1].id;
    const { jsonRequest } = await import("@/lib/test-helpers/api-route");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { asNext: true }),
      routeCtx({ id: issue.id, itemId: secondId }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).issue.actionItems.map((a: { text: string }) => a.text)).toEqual(["後", "先"]);
  });

  it("存在しないissue/itemIdは404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(new Request("http://localhost/x", { method: "PATCH" }), routeCtx({ id: "missing", itemId: "missing" }));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/issues/[id]/action-items/[itemId]", () => {
  it("Action Itemを削除できる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    await issueStore.addActionItem(issue.id, "残す");
    const withSecond = await issueStore.addActionItem(issue.id, "消す");
    const itemId = withSecond!.actionItems[1].id;

    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeCtx({ id: issue.id, itemId }));
    expect(res.status).toBe(200);
    expect((await res.json()).issue.actionItems.map((a: { text: string }) => a.text)).toEqual(["残す"]);
  });

  it("存在しないissue/itemIdは404", async () => {
    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeCtx({ id: "missing", itemId: "missing" }));
    expect(res.status).toBe(404);
  });
});

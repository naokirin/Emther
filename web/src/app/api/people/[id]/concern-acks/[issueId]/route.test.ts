import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@core/test-helpers/api-route";

vi.mock("@core/local-model", () => ({
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

// ユーザー指摘「メンバーのアラート表示を確認したが対応不要だったことを示せない」対応。
describe("PATCH /api/people/[id]/concern-acks/[issueId]", () => {
  it("存在しない人物は404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { acknowledged: true }),
      routeCtx({ id: "missing", issueId: "issue-1" }),
    );
    expect(res.status).toBe(404);
  });

  it("acknowledgedが未指定は400", async () => {
    const peopleDirectory = await import("@core/people-directory");
    const id = peopleDirectory.registerName("Aさん");
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", {}), routeCtx({ id, issueId: "issue-1" }));
    expect(res.status).toBe(400);
  });

  it("acknowledged: trueで確認済みを記録し、people-hubのhasConcerningIssueから除外される", async () => {
    const peopleDirectory = await import("@core/people-directory");
    const issueStore = await import("@core/issue-store");
    const hub = await import("@/lib/people-hub");
    const id = peopleDirectory.registerName("Aさん");
    const issue = await issueStore.createIssue("Aさんの育成計画");
    issueStore.setIssueStatus(issue.id, "blocked");
    expect(hub.getPersonProfile(id)?.hasConcerningIssue).toBe(true);

    const route = await import("./route");
    const ackRes = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { acknowledged: true, note: "対応不要" }),
      routeCtx({ id, issueId: issue.id }),
    );
    expect(ackRes.status).toBe(200);
    expect(hub.getPersonProfile(id)?.hasConcerningIssue).toBe(false);

    const clearRes = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { acknowledged: false }),
      routeCtx({ id, issueId: issue.id }),
    );
    expect(clearRes.status).toBe(200);
    expect(hub.getPersonProfile(id)?.hasConcerningIssue).toBe(true);
  });
});

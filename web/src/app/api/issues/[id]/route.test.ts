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

describe("GET /api/issues/[id]", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/api/issues/missing"), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("存在すれば実名復元済みで返す", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("既存Issue");
    const route = await import("./route");
    const res = await route.GET(new Request(`http://localhost/api/issues/${issue.id}`), routeCtx({ id: issue.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).issue.title).toBe("既存Issue");
  });
});

describe("PATCH /api/issues/[id]", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/api/issues/missing", "PATCH", { why: "x" }),
      routeCtx({ id: "missing" }),
    );
    expect(res.status).toBe(404);
  });

  it("titleを空文字にしようとすると400", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${issue.id}`, "PATCH", { title: "  " }),
      routeCtx({ id: issue.id }),
    );
    expect(res.status).toBe(400);
  });

  it("charter/title/tags/keyResultId/teamIdをまとめて更新できる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("元のタイトル");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${issue.id}`, "PATCH", {
        title: "新しいタイトル",
        why: "理由",
        tags: ["技術的負債"],
        keyResultId: "kr-1",
        teamId: "team-1",
      }),
      routeCtx({ id: issue.id }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.issue.title).toBe("新しいタイトル");
    expect(json.issue.charter.why).toBe("理由");
    expect(json.issue.tags).toEqual(["技術的負債"]);
    expect(json.issue.keyResultId).toBe("kr-1");
    expect(json.issue.teamId).toBe("team-1");
  });

  it("keyResultId/teamIdにnullを渡すと解除できる（キー自体が無ければ変更しない）", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    issueStore.setIssueKeyResult(issue.id, "kr-1");
    issueStore.setIssueTeam(issue.id, "team-1");
    const route = await import("./route");

    const untouched = await route.PATCH(jsonRequest(`http://localhost/api/issues/${issue.id}`, "PATCH", {}), routeCtx({ id: issue.id }));
    expect((await untouched.json()).issue.keyResultId).toBe("kr-1");

    const cleared = await route.PATCH(
      jsonRequest(`http://localhost/api/issues/${issue.id}`, "PATCH", { keyResultId: null, teamId: null }),
      routeCtx({ id: issue.id }),
    );
    const json = await cleared.json();
    expect(json.issue.keyResultId).toBeUndefined();
    expect(json.issue.teamId).toBeUndefined();
  });
});

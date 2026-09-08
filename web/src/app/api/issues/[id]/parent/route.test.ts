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

describe("POST /api/issues/[id]/parent", () => {
  it("titleが無ければ400", async () => {
    const issueStore = await import("@/lib/issue-store");
    const child = await issueStore.createIssue("既存Issue");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: child.id }));
    expect(res.status).toBe(400);
  });

  it("既に子Issueを持つ場合は400（1階層制限）", async () => {
    const issueStore = await import("@/lib/issue-store");
    const parent = await issueStore.createIssue("親");
    await issueStore.createIssue("子", undefined, undefined, parent.id);
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { title: "祖父Issue" }), routeCtx({ id: parent.id }));
    expect(res.status).toBe(400);
  });

  it("上位Issueを作成し既存Issueをその子に付け替える（201）", async () => {
    const issueStore = await import("@/lib/issue-store");
    const child = await issueStore.createIssue("既存Issue");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { title: "上位Issue" }), routeCtx({ id: child.id }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.issue.title).toBe("上位Issue");
    expect(issueStore.getIssue(child.id)?.parentId).toBe(json.issue.id);
  });
});

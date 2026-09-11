import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { routeCtx } from "@/lib/test-helpers/api-route";

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

describe("GET /api/issues/[id]/impact", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x"), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("チームに紐づいていないIssueはimpact:nullを返す", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x"), routeCtx({ id: issue.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).impact).toBeNull();
  });

  it("チームに紐づいていればimpactを算出する", async () => {
    const issueStore = await import("@/lib/issue-store");
    const orgStore = await import("@/lib/org-context-store");
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    const issue = await issueStore.createIssue("Issue", undefined, undefined, undefined, undefined, undefined, team.id);
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/x"), routeCtx({ id: issue.id }));
    const json = await res.json();
    expect(json.impact.inProgress).toBe(true);
  });
});

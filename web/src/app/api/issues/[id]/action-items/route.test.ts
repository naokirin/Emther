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

describe("POST /api/issues/[id]/action-items", () => {
  it("textが無ければ400", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest(`http://localhost/api/issues/${issue.id}/action-items`, "POST", { text: "  " }),
      routeCtx({ id: issue.id }),
    );
    expect(res.status).toBe(400);
  });

  it("存在しないIssueは404", async () => {
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/issues/missing/action-items", "POST", { text: "やること" }),
      routeCtx({ id: "missing" }),
    );
    expect(res.status).toBe(404);
  });

  it("追加できる（201）", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest(`http://localhost/api/issues/${issue.id}/action-items`, "POST", { text: "レビュー依頼" }),
      routeCtx({ id: issue.id }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.issue.actionItems).toHaveLength(1);
    expect(json.issue.actionItems[0].text).toBe("レビュー依頼");
  });

  it("asNext:trueで先頭に追加できる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("Issue");
    await issueStore.addActionItem(issue.id, "既存");
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest(`http://localhost/api/issues/${issue.id}/action-items`, "POST", { text: "次の一手", asNext: true }),
      routeCtx({ id: issue.id }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.issue.actionItems.map((a: { text: string }) => a.text)).toEqual(["次の一手", "既存"]);
  });
});

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

async function insertRun(issueNotes: unknown) {
  const { getDb } = await import("@/lib/db");
  getDb()
    .prepare(
      `INSERT INTO agent_runs
        (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed, suggested_issue_notes_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("run-1", "Lead Agent", "t", "idle", 0, 1, 1, "manual", 1, issueNotes ? JSON.stringify(issueNotes) : null);
}

describe("POST /api/agents/[id]/issue-notes", () => {
  it("対象Issueのlogへ追記し、提案を消す", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("対象Issue");
    await insertRun([{ issueId: issue.id, text: "見つけた事実" }]);
    const route = await import("./route");
    const res = await route.POST(new Request("http://localhost/x", { method: "POST" }), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.written).toEqual([{ issueId: issue.id, text: "見つけた事実" }]);
    expect(json.run.suggestedIssueNotes).toBeUndefined();
    expect(issueStore.getIssue(issue.id)?.logEntries.map((l) => l.text)).toEqual(["見つけた事実"]);
  });

  it("提案が無ければ400", async () => {
    await insertRun(undefined);
    const route = await import("./route");
    const res = await route.POST(new Request("http://localhost/x", { method: "POST" }), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(400);
  });

  it("runが無ければ404", async () => {
    const route = await import("./route");
    const res = await route.POST(new Request("http://localhost/x", { method: "POST" }), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("indicesを指定すると選んだ提案だけを採用し、残りは提案のまま残す", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issueA = await issueStore.createIssue("対象IssueA");
    const issueB = await issueStore.createIssue("対象IssueB");
    await insertRun([
      { issueId: issueA.id, text: "Aの事実" },
      { issueId: issueB.id, text: "Bの事実" },
    ]);
    const route = await import("./route");
    const res = await route.POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indices: [0] }),
      }),
      routeCtx({ id: "run-1" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.written).toEqual([{ issueId: issueA.id, text: "Aの事実" }]);
    expect(json.run.suggestedIssueNotes).toEqual([{ issueId: issueB.id, text: "Bの事実" }]);
    expect(issueStore.getIssue(issueA.id)?.logEntries.map((l) => l.text)).toEqual(["Aの事実"]);
    expect(issueStore.getIssue(issueB.id)?.logEntries).toEqual([]);
  });
});

describe("DELETE /api/agents/[id]/issue-notes", () => {
  it("提案を却下できる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("対象Issue");
    await insertRun([{ issueId: issue.id, text: "見つけた事実" }]);
    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).run.suggestedIssueNotes).toBeUndefined();
    expect(issueStore.getIssue(issue.id)?.logEntries).toEqual([]);
  });

  it("reason:handledだと対応済みとしてrunログに残した上で提案を消す", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("対象Issue");
    await insertRun([{ issueId: issue.id, text: "見つけた事実" }]);
    const route = await import("./route");
    const res = await route.DELETE(
      new Request("http://localhost/x", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "handled" }),
      }),
      routeCtx({ id: "run-1" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.run.suggestedIssueNotes).toBeUndefined();
    expect(json.run.log.some((l: { text: string }) => l.text.includes("対応済み"))).toBe(true);
  });

  it("indicesを指定すると選んだ提案だけを却下し、残りは提案のまま残す", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issueA = await issueStore.createIssue("対象IssueA");
    const issueB = await issueStore.createIssue("対象IssueB");
    await insertRun([
      { issueId: issueA.id, text: "Aの事実" },
      { issueId: issueB.id, text: "Bの事実" },
    ]);
    const route = await import("./route");
    const res = await route.DELETE(
      new Request("http://localhost/x", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indices: [0] }),
      }),
      routeCtx({ id: "run-1" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.run.suggestedIssueNotes).toEqual([{ issueId: issueB.id, text: "Bの事実" }]);
  });
});

import { EventEmitter } from "node:events";
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

// このAPIも上位Issue作成のたびにLead Agentの分析Runを自動で起動するようになった。
// /api/issues/route.test.tsと同じ理由で、実際のCLI子プロセスを起動しないようモックする。
vi.mock("node:child_process", () => ({
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => child.emit("error", new Error("spawn claude ENOENT (mocked in test)")));
    return child;
  },
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

  // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
  // 対応。上位Issueも新規に起票される「素のIssue」のため、/api/issuesのPOSTと同じく
  // Lead Agentの分析Runが自動で紐づく。
  it("上位Issueの作成時もLead Agentの分析Runを自動で起動し、紐づける", async () => {
    const issueStore = await import("@/lib/issue-store");
    const child = await issueStore.createIssue("既存Issue");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { title: "上位Issue" }), routeCtx({ id: child.id }));
    const json = await res.json();

    const agentRuntime = await import("@/lib/agent-runtime");
    const runs = agentRuntime.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].agentName).toBe("Lead Agent");
    expect(runs[0].task).toContain("上位Issue");
    expect(json.issue.agentRunId).toBe(runs[0].id);
  });
});

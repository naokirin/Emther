import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
}));

vi.mock("@/lib/cloud-chat", () => ({
  runCloudChat: vi.fn(async () => {
    throw new Error("cloud disabled in hierarchy-flow tests");
  }),
}));

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

describe("POST /api/issues/triage/suggest", () => {
  it("親Issueを採点して triage を返す", async () => {
    const issueStore = await import("@/lib/issue-store");
    const issue = await issueStore.createIssue("ブロッカー介入", undefined, {
      why: "組織リスク",
      what: "解消",
      how: "合意形成",
    });
    issueStore.setIssueStatus(issue.id, "blocked");
    issueStore.setIssueTeam(issue.id, "team-1");
    issueStore.setIssueTheme(issue.id, "th-1");

    const route = await import("@/app/api/issues/triage/suggest/route");
    const res = await route.POST(jsonRequest("http://localhost/api/issues/triage/suggest", "POST", { focusLimit: 5 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.issues)).toBe(true);
    expect(data.issues[0].triage).toBeTruthy();
    expect(data.issues[0].themeId).toBe("th-1");
    expect(data.counts).toBeTruthy();
    expect(Array.isArray(data.differing)).toBe(true);
    expect(Array.isArray(data.focusCandidates)).toBe(true);
  });

  it("提案を反映すると帯が変わり changes が返る", async () => {
    const issueStore = await import("@/lib/issue-store");
    const low = await issueStore.createIssue("放置気味", undefined, { why: "", what: "", how: "" });
    issueStore.setIssuePriority(low.id, "focus");
    // 古い更新日時にして parked 寄りにする（setIssuePriority の後に上書き）
    const stored = issueStore.getIssue(low.id)!;
    stored.updatedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
    stored.createdAt = Date.now() - 40 * 24 * 60 * 60 * 1000;

    const high = await issueStore.createIssue("今すぐ見るべき", undefined, {
      why: "リスク",
      what: "介入",
      how: "合意",
    });
    issueStore.setIssueStatus(high.id, "blocked");
    issueStore.setIssueTeam(high.id, "t1");
    issueStore.setIssueTheme(high.id, "th1");
    issueStore.setIssueKeyResult(high.id, "kr1");
    issueStore.setIssueTags(high.id, ["リスク", "組織"]);
    issueStore.setIssuePriority(high.id, "parked");

    const route = await import("@/app/api/issues/triage/suggest/route");
    const preview = await route.POST(
      jsonRequest("http://localhost/api/issues/triage/suggest", "POST", { applySuggested: false }),
    );
    const previewData = await preview.json();
    expect(previewData.applied).toBe(false);
    expect(previewData.changes).toEqual([]);

    const applied = await route.POST(
      jsonRequest("http://localhost/api/issues/triage/suggest", "POST", { applySuggested: true, focusLimit: 5 }),
    );
    const data = await applied.json();
    expect(data.applied).toBe(true);
    expect(data.changes.length).toBeGreaterThan(0);
    expect(issueStore.getIssue(high.id)?.priority).toBe("focus");
  });
});

describe("POST /api/issues/[id]/triage", () => {
  it("単一 Issue を再採点できる", async () => {
    const issueStore = await import("@/lib/issue-store");
    const { jsonRequest, routeCtx } = await import("@/lib/test-helpers/api-route");
    const issue = await issueStore.createIssue("単体再採点", undefined, {
      why: "価値",
      what: "範囲",
      how: "方法",
    });
    issueStore.setIssueTheme(issue.id, "th-x");
    issueStore.setIssueStatus(issue.id, "blocked");

    const route = await import("@/app/api/issues/[id]/triage/route");
    const res = await route.POST(
      jsonRequest(`http://localhost/api/issues/${issue.id}/triage`, "POST", { applySuggested: false }),
      routeCtx({ id: issue.id }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.issue.triage).toBeTruthy();
    expect(data.applied).toBe(false);
    expect(data.issue.priority).toBe("normal");

    const applyRes = await route.POST(
      jsonRequest(`http://localhost/api/issues/${issue.id}/triage`, "POST", { applySuggested: true }),
      routeCtx({ id: issue.id }),
    );
    const applied = await applyRes.json();
    expect(applied.issue.triage.suggestedPriority).toBeTruthy();
    if (applied.changed) {
      expect(applied.issue.priority).toBe(applied.to);
    }
  });
});

describe("POST /api/themes/from-okr", () => {
  it("Objective から候補テーマを生成する", async () => {
    const org = await import("@/lib/org-context-store");
    const objective = await org.addObjective("デリバリー速度を上げる", undefined, "リードタイム短縮");
    await org.addKeyResult(objective.id, "デプロイ頻度を週2回に");

    const route = await import("@/app/api/themes/from-okr/route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/themes/from-okr", "POST", { objectiveIds: [objective.id] }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.themes).toHaveLength(1);
    expect(data.themes[0].objectiveIds).toEqual([objective.id]);
    expect(data.themes[0].status).toBe("candidate");
  });
});

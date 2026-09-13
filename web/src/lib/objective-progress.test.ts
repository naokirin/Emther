import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

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

async function loadModule() {
  return import("@/lib/objective-progress");
}

describe("listObjectivesWithProgress", () => {
  it("KeyResultに紐づくIssueのdone数（!archived）から進捗を計算する", async () => {
    const progressModule = await loadModule();
    const orgStore = await import("@/lib/org-context-store");
    const issueStore = await import("@/lib/issue-store");

    const objective = await orgStore.addObjective("売上を伸ばす");
    const withKr = await orgStore.addKeyResult(objective.id, "新規契約10件");
    const krId = withKr!.keyResults[0].id;

    const issue1 = await issueStore.createIssue("契約A", undefined, undefined, undefined, undefined, krId);
    await issueStore.createIssue("契約B", undefined, undefined, undefined, undefined, krId);
    issueStore.setIssueStatus(issue1.id, "done");

    const progress = progressModule.listObjectivesWithProgress();
    expect(progress[0].progress[0]).toEqual({ keyResultId: krId, total: 2, done: 1 });
  });

  it("archivedなIssueを分母からも除外する", async () => {
    const progressModule = await loadModule();
    const orgStore = await import("@/lib/org-context-store");
    const issueStore = await import("@/lib/issue-store");

    const objective = await orgStore.addObjective("売上を伸ばす");
    const withKr = await orgStore.addKeyResult(objective.id, "新規契約10件");
    const krId = withKr!.keyResults[0].id;

    const issue1 = await issueStore.createIssue("契約A", undefined, undefined, undefined, undefined, krId);
    await issueStore.createIssue("契約B", undefined, undefined, undefined, undefined, krId);
    issueStore.setIssueArchived(issue1.id, true);

    const progress = progressModule.listObjectivesWithProgress();
    expect(progress[0].progress[0]).toEqual({ keyResultId: krId, total: 1, done: 0 });
  });
});

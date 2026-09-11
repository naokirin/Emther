import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("person-evaluation-store", () => {
  it("仮置きログを作成し状態遷移できる", async () => {
    const store = await import("@/lib/person-evaluation-store");
    const log = await store.createEvaluationLog({
      personId: "PERSON_1",
      lens: "outcome",
      sourceJournalId: "j1",
      snapshotText: "リリースを主導した",
      rationale: "KR達成への寄与候補",
      targetObjectiveId: "obj-1",
    });
    expect(log.status).toBe("provisional");
    expect(store.listEvaluationLogsForPerson("PERSON_1")).toHaveLength(1);

    const confirmed = store.setEvaluationLogStatus(log.id, "confirmed");
    expect(confirmed?.status).toBe("confirmed");

    const discarded = store.setEvaluationLogStatus(log.id, "discarded");
    expect(discarded?.status).toBe("discarded");
  });

  it("bundle は A/B を分け不足を返す", async () => {
    const store = await import("@/lib/person-evaluation-store");
    await store.createEvaluationLog({
      personId: "PERSON_1",
      lens: "outcome",
      sourceJournalId: "j1",
      snapshotText: "成果",
      rationale: "r",
    });
    const bundle = store.bundleEvaluationLogs("PERSON_1");
    expect(bundle.outcome).toHaveLength(1);
    expect(bundle.value).toHaveLength(0);
    expect(bundle.missing).toContain("Value 体現ログが不足");
  });
});

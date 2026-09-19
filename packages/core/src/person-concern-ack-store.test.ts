import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "./test-helpers/store-env";

vi.mock("./local-model", () => ({
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
describe("person-concern-ack-store", () => {
  it("記録・一覧・取り消しができる", async () => {
    const store = await import("./person-concern-ack-store");
    expect(store.listPersonIssueConcernAcks("PERSON_1")).toEqual([]);

    const ack = await store.acknowledgePersonIssueConcern("PERSON_1", "issue-1", "対応不要と判断");
    expect(ack.personId).toBe("PERSON_1");
    expect(ack.issueId).toBe("issue-1");
    expect(ack.note).toBe("対応不要と判断");

    expect(store.listAcknowledgedIssueIds("PERSON_1")).toEqual(new Set(["issue-1"]));

    store.clearPersonIssueConcernAck("PERSON_1", "issue-1");
    expect(store.listPersonIssueConcernAcks("PERSON_1")).toEqual([]);
  });

  it("同じ人物×Issueに再度acknowledgeすると上書きされる（重複行にならない）", async () => {
    const store = await import("./person-concern-ack-store");
    await store.acknowledgePersonIssueConcern("PERSON_1", "issue-1", "1回目");
    await store.acknowledgePersonIssueConcern("PERSON_1", "issue-1", "2回目");
    const acks = store.listPersonIssueConcernAcks("PERSON_1");
    expect(acks).toHaveLength(1);
    expect(acks[0].note).toBe("2回目");
  });

  it("人物ごとに独立している", async () => {
    const store = await import("./person-concern-ack-store");
    await store.acknowledgePersonIssueConcern("PERSON_1", "issue-1");
    expect(store.listPersonIssueConcernAcks("PERSON_2")).toEqual([]);
  });
});

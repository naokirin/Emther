import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@core/test-helpers/api-route";

vi.mock("@core/local-model", () => ({
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

// ユーザー指摘「懸念を確認したが対応不要だった、を示せず強調を減らせない」対応。
describe("PATCH /api/people/[id]/evaluation-logs/[logId]", () => {
  it("存在しないlogIdは404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { status: "confirmed" }),
      routeCtx({ id: "PERSON_1", logId: "missing" }),
    );
    expect(res.status).toBe(404);
  });

  it("statusもnoActionNeededも無い場合は400", async () => {
    const store = await import("@/lib/person-evaluation-store");
    const log = await store.createEvaluationLog({
      personId: "PERSON_1",
      lens: "outcome",
      sourceJournalId: "j1",
      snapshotText: "成果",
      rationale: "r",
    });
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", {}), routeCtx({ id: "PERSON_1", logId: log.id }));
    expect(res.status).toBe(400);
  });

  it("noActionNeeded: trueで懸念の確認済みを記録し、falseで取り消せる", async () => {
    const store = await import("@/lib/person-evaluation-store");
    const log = await store.createEvaluationLog({
      personId: "PERSON_1",
      lens: "outcome",
      polarity: "concern",
      sourceJournalId: "j1",
      snapshotText: "懸念",
      rationale: "r",
    });
    const route = await import("./route");

    const ackRes = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { noActionNeeded: true, noActionNeededNote: "対応不要" }),
      routeCtx({ id: "PERSON_1", logId: log.id }),
    );
    expect(ackRes.status).toBe(200);
    const acked = (await ackRes.json()).log;
    expect(acked.polarity).toBe("concern");
    expect(acked.noActionNeededAt).toBeDefined();
    expect(acked.noActionNeededNote).toBe("対応不要");
    expect(acked.status).toBe("provisional"); // statusは変わらない

    const clearRes = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { noActionNeeded: false }),
      routeCtx({ id: "PERSON_1", logId: log.id }),
    );
    const cleared = (await clearRes.json()).log;
    expect(cleared.noActionNeededAt).toBeUndefined();
  });

  it("statusとnoActionNeededを同時に指定できる", async () => {
    const store = await import("@/lib/person-evaluation-store");
    const log = await store.createEvaluationLog({
      personId: "PERSON_1",
      lens: "outcome",
      polarity: "concern",
      sourceJournalId: "j1",
      snapshotText: "懸念",
      rationale: "r",
    });
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { status: "confirmed", noActionNeeded: true }),
      routeCtx({ id: "PERSON_1", logId: log.id }),
    );
    const updated = (await res.json()).log;
    expect(updated.status).toBe("confirmed");
    expect(updated.noActionNeededAt).toBeDefined();
  });
});

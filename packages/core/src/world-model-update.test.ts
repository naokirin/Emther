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

async function seed() {
  const store = await import("./world-model-store");
  const el = await store.createWorldModelElement({
    kind: "dependency",
    title: "レビュー待ち",
    statement: "リリースがAチームのレビュー待ちで詰まる",
    origin: "user",
  });
  return { store, el };
}

describe("world-model 差分の取り込みと適用", () => {
  it("既存要素への更新提案は pending で保存され、適用するまでモデルは変わらない", async () => {
    const { store, el } = await seed();
    const r = await store.ingestWorldModelChanges(
      [{ action: "refine", targetId: el.id, reason: "月末だけに偏る", statement: "レビュー待ちは月末に集中する" }],
      { sourceRunId: "run1" },
    );
    expect(r).toEqual({ created: 0, proposals: 1, skipped: 0 });
    expect(store.getWorldModelElement(el.id)?.statement).toBe("リリースがAチームのレビュー待ちで詰まる");

    const [update] = store.listWorldModelUpdates({ status: "pending" });
    const applied = await store.applyWorldModelUpdate(update!.id);
    expect(applied?.element?.supersedes).toBe(el.id);
    expect(applied?.element?.status).toBe("pinned");
    expect(applied?.update.status).toBe("applied");
  });

  it("新規は candidate で作り、存在しない対象・重複・評価的記述・statement の無い refine は見送る", async () => {
    const { store, el } = await seed();
    const r = await store.ingestWorldModelChanges([
      { action: "new", kind: "flow", title: "判断の所在", statement: "仕様判断はテックリードが行う", reason: "複数回観測" },
      { action: "confirm", targetId: "nope", reason: "x" },
      { action: "confirm", targetId: el.id, reason: "再観測" },
      { action: "confirm", targetId: el.id, reason: "再観測（重複）" },
      { action: "refine", targetId: el.id, reason: "r" },
      { action: "contradict", targetId: el.id, reason: "PERSON_1 は無能", statement: "別の見立て" },
    ]);
    expect(r).toEqual({ created: 1, proposals: 1, skipped: 4 });
    expect(store.listWorldModelElements({ status: "candidate" })).toHaveLength(1);
  });

  it("confirm は確認日と根拠を更新し、statement の無い contradict は stale にする", async () => {
    const { store, el } = await seed();
    await store.ingestWorldModelChanges([
      { action: "confirm", targetId: el.id, reason: "再観測", evidence: { journalIds: ["j1"] } },
    ]);
    const [u] = store.listWorldModelUpdates({ status: "pending" });
    const done = await store.applyWorldModelUpdate(u!.id);
    expect(done?.element?.evidence.journalIds).toEqual(["j1"]);

    await store.ingestWorldModelChanges([{ action: "contradict", targetId: el.id, reason: "状況が変わった" }]);
    const [c] = store.listWorldModelUpdates({ status: "pending" });
    const stale = await store.applyWorldModelUpdate(c!.id);
    expect(stale?.element?.status).toBe("stale");
  });

  it("訂正を伴う適用は同じ対象の他の pending を却下し、却下は要素を変えない", async () => {
    const { store, el } = await seed();
    await store.ingestWorldModelChanges([
      { action: "refine", targetId: el.id, reason: "a", statement: "新しい見立て" },
      { action: "stale", targetId: el.id, reason: "b" },
    ]);
    const pending = store.listWorldModelUpdates({ status: "pending" });
    const refine = pending.find((u) => u.action === "refine")!;
    await store.applyWorldModelUpdate(refine.id);
    expect(store.listWorldModelUpdates({ status: "pending" })).toHaveLength(0);
    expect(store.listWorldModelUpdates({ status: "dismissed" })).toHaveLength(1);
  });
});

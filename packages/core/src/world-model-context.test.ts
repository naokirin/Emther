import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "./test-helpers/store-env";

vi.mock("./local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

// 「レビュー」を含む文は [1,0]、それ以外は [0,1] とする疑似埋め込み。
vi.mock("./embeddings", () => ({
  embedText: vi.fn(async (t: string) => (t.includes("レビュー") ? [1, 0] : [0, 1])),
  cosineSimilarity: (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]!,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("buildWorldModelContextBlock", () => {
  it("要素が無ければ空、candidate・stale は注入しない", async () => {
    const store = await import("./world-model-store");
    const { buildWorldModelContextBlock } = await import("./world-model-context");
    expect(await buildWorldModelContextBlock("何か")).toBe("");

    await store.createWorldModelElement({ kind: "flow", title: "候補", statement: "未採用" });
    const stale = await store.createWorldModelElement({
      kind: "flow",
      title: "古い",
      statement: "古い見立て",
      origin: "user",
    });
    store.markStaleWorldModelElements(0, Date.now() + 1000);
    expect(store.getWorldModelElement(stale.id)?.status).toBe("stale");
    expect(await buildWorldModelContextBlock("何か")).toBe("");
  });

  it("少数なら全文を注入し、worldModelRefs の指示を付ける", async () => {
    const store = await import("./world-model-store");
    const { buildWorldModelContextBlock } = await import("./world-model-context");
    const el = await store.createWorldModelElement({
      kind: "dependency",
      title: "レビュー待ち",
      statement: "リリースがレビュー待ちで詰まる",
      origin: "user",
    });
    const block = await buildWorldModelContextBlock("");
    expect(block).toContain(`[${el.id}]`);
    expect(block).toContain("リリースがレビュー待ちで詰まる");
    expect(block).toContain("worldModelRefs");
  });

  it("多数なら関連要素だけ全文、他は索引にとどめる", async () => {
    const store = await import("./world-model-store");
    const { buildWorldModelContextBlock } = await import("./world-model-context");
    for (let i = 0; i < 12; i++) {
      await store.createWorldModelElement({
        kind: "flow",
        title: `無関係${i}`,
        statement: `全文本文${i}`,
        origin: "user",
      });
    }
    const target = await store.createWorldModelElement({
      kind: "dependency",
      title: "レビュー待ち",
      statement: "レビュー待ちの詳細本文",
      origin: "user",
    });
    const block = await buildWorldModelContextBlock("レビューが遅い");
    expect(block).toContain("レビュー待ちの詳細本文");
    expect(block).toContain(`[${target.id}]`);
    expect(block).not.toContain("全文本文0");
    expect(block).not.toContain("無関係0");
    expect(block).toContain("他に 12 件");
  });

  it("関連が無く固定も無ければ何も注入しない", async () => {
    const store = await import("./world-model-store");
    const { buildWorldModelContextBlock } = await import("./world-model-context");
    for (let i = 0; i < 8; i++) {
      await store.createWorldModelElement({ kind: "flow", title: `無関係${i}`, statement: `本文${i}`, origin: "user" });
    }
    expect(await buildWorldModelContextBlock("レビューが遅い")).toBe("");
  });
});

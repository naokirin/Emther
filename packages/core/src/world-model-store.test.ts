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

const base = { kind: "dependency" as const, title: "レビュー待ち", statement: "リリースがAチームのレビュー待ちで詰まる" };

describe("world-model-store", () => {
  it("AI 由来は candidate、採用するまで active に入らない", async () => {
    const store = await import("./world-model-store");
    const el = await store.createWorldModelElement(base);
    expect(el.status).toBe("candidate");
    expect(store.listActiveWorldModelElements()).toHaveLength(0);

    store.adoptWorldModelElement(el.id);
    expect(store.listActiveWorldModelElements()).toHaveLength(1);

    store.dismissWorldModelElement(el.id);
    expect(store.listActiveWorldModelElements()).toHaveLength(0);
  });

  it("ユーザー手動追加は adopted で始まる", async () => {
    const store = await import("./world-model-store");
    const el = await store.createWorldModelElement({ ...base, origin: "user" });
    expect(el.status).toBe("adopted");
  });

  it("訂正は pinned の新版を作り、旧版は一覧から外れるが残る", async () => {
    const store = await import("./world-model-store");
    const el = await store.createWorldModelElement(base);
    store.adoptWorldModelElement(el.id);
    const revised = await store.reviseWorldModelElement(el.id, { statement: "レビュー待ちは月末だけ" });
    expect(revised?.status).toBe("pinned");
    expect(revised?.supersedes).toBe(el.id);
    expect(store.listWorldModelElements().map((e) => e.id)).toEqual([revised?.id]);
    expect(store.getWorldModelElement(el.id)).toBeDefined();
    expect(await store.reviseWorldModelElement(el.id, { statement: "x" })).toBeUndefined();
  });

  it("stale 化は pinned を対象にしない", async () => {
    const store = await import("./world-model-store");
    const a = await store.createWorldModelElement({ ...base, origin: "user" });
    const b = await store.createWorldModelElement({ ...base, title: "別", origin: "user" });
    store.pinWorldModelElement(b.id);
    const touched = store.markStaleWorldModelElements(30, Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(touched).toEqual([a.id]);
    expect(store.getWorldModelElement(b.id)?.status).toBe("pinned");
    expect(store.confirmWorldModelElement(a.id)?.status).toBe("adopted");
  });

  it("relationship は 2 主体と aspect に合う stance を要求する", async () => {
    const store = await import("./world-model-store");
    const ok = await store.createWorldModelElement({
      kind: "relationship",
      title: "C と D の関係",
      statement: "懸念を直接言いにくい空気がある",
      relationship: {
        parties: [
          { type: "person", id: "PERSON_1" },
          { type: "team", id: "team-x" },
        ],
        aspect: "psychological",
        stance: "psychological_safety",
      },
    });
    expect(ok.relationship?.stance).toBe("psychological_safety");

    await expect(
      store.createWorldModelElement({
        kind: "relationship",
        title: "t",
        statement: "s",
        relationship: {
          parties: [
            { type: "person", id: "PERSON_1" },
            { type: "person", id: "PERSON_2" },
          ],
          aspect: "work",
          stance: "trust",
        },
      }),
    ).rejects.toThrow(/stance/);
  });

  it("人物は PERSON_n のみで、AI 由来の評価的記述は拒否する", async () => {
    const store = await import("./world-model-store");
    await expect(store.createWorldModelElement({ ...base, personIds: ["田中"] })).rejects.toThrow(/PERSON_n/);
    await expect(
      store.createWorldModelElement({ ...base, statement: "PERSON_1 は無能で足を引っ張る" }),
    ).rejects.toThrow(/評価/);
  });
});

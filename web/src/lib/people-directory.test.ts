import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

// maskForStorage()はローカルNERモデルを経由せず既知名のマスクのみ行う。
// 候補検出（detectUnregisteredNameCandidates）はrunLocalChatを使うため、
// テストでは実モデルを使わず固定応答を返すモックに差し替える。
let mockPeople: string[] = [];
vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: mockPeople })),
  extractFirstJsonObject: (text: string) => text,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  mockPeople = [];
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModule() {
  return import("@/lib/people-directory");
}

describe("registerName / maskNames / unmaskNames", () => {
  it("新規名にPERSON_n IDを発行する", async () => {
    const pd = await loadModule();
    const id = pd.registerName("Aさん");
    expect(id).toBe("PERSON_1");
  });

  it("同じ名前を再登録しても同じIDを返す", async () => {
    const pd = await loadModule();
    const id1 = pd.registerName("Aさん");
    const id2 = pd.registerName("Aさん");
    expect(id1).toBe(id2);
  });

  it("前後の空白はtrimして同一人物とみなす", async () => {
    const pd = await loadModule();
    const id1 = pd.registerName("Aさん");
    const id2 = pd.registerName("  Aさん  ");
    expect(id1).toBe(id2);
  });

  it("敬称の違い（さん／くん／なし）は同一人物とみなす", async () => {
    const pd = await loadModule();
    const id1 = pd.registerName("田中さん");
    const id2 = pd.registerName("田中くん");
    const id3 = pd.registerName("田中");
    expect(id1).toBe(id2);
    expect(id1).toBe(id3);
    expect(pd.listPeople()).toEqual([
      { id: id1, name: "田中さん", aliases: expect.arrayContaining(["田中くん", "田中"]) },
    ]);
  });

  it("maskNamesは登録時と異なる敬称でも同じIDへ置換する", async () => {
    const pd = await loadModule();
    const id = pd.registerName("田中さん");
    expect(pd.maskNames("田中くんと話した")).toBe(`${id}と話した`);
    expect(pd.maskNames("田中と話した")).toBe(`${id}と話した`);
  });

  it("getPersonIdは敬称違いでも同一人物を返す", async () => {
    const pd = await loadModule();
    const id = pd.registerName("田中さん");
    expect(pd.getPersonId("田中くん")).toBe(id);
    expect(pd.getPersonId("田中")).toBe(id);
  });

  it("maskNamesは登録済みの名前をIDに置換する", async () => {
    const pd = await loadModule();
    const id = pd.registerName("Aさん");
    expect(pd.maskNames(`${"Aさん"}と話した`)).toBe(`${id}と話した`);
  });

  it("unmaskNamesはIDを実名に戻す", async () => {
    const pd = await loadModule();
    const id = pd.registerName("Aさん");
    expect(pd.unmaskNames(`${id}と話した`)).toBe("Aさんと話した");
  });

  it("長い名前が短い名前のprefixになっていても最長一致を優先する", async () => {
    const pd = await loadModule();
    pd.registerName("山田");
    const idFull = pd.registerName("山田太郎");
    expect(pd.maskNames("山田太郎に会った")).toBe(`${idFull}に会った`);
  });

  it("PERSON_1とPERSON_10のように短いIDが長いIDのprefixでも壊れず復元できる", async () => {
    const pd = await loadModule();
    for (let i = 0; i < 9; i++) pd.registerName(`人物${i}`);
    const id10 = pd.registerName("10番目の人");
    expect(id10).toBe("PERSON_10");
    expect(pd.unmaskNames(`${id10}が来た`)).toBe("10番目の人が来た");
  });
});

describe("listPeople / getPersonId / deletePerson", () => {
  it("登録済みの人物を一覧できる", async () => {
    const pd = await loadModule();
    pd.registerName("Aさん");
    pd.registerName("Bさん");
    expect(pd.listPeople()).toEqual(
      expect.arrayContaining([
        { id: "PERSON_1", name: "Aさん", aliases: [] },
        { id: "PERSON_2", name: "Bさん", aliases: [] },
      ]),
    );
  });

  it("getPersonIdは未登録の名前に対して新規登録しない（副作用なし）", async () => {
    const pd = await loadModule();
    expect(pd.getPersonId("未登録さん")).toBeUndefined();
    expect(pd.listPeople()).toHaveLength(0);
  });

  it("deletePersonは対応表からエントリを削除する", async () => {
    const pd = await loadModule();
    const id = pd.registerName("Aさん");
    expect(pd.deletePerson(id)).toBe(true);
    expect(pd.listPeople()).toHaveLength(0);
    // 削除後はunmaskしても実名に戻らない
    expect(pd.unmaskNames(id)).toBe(id);
  });

  it("存在しないIDのdeletePersonはfalseを返す", async () => {
    const pd = await loadModule();
    expect(pd.deletePerson("PERSON_999")).toBe(false);
  });
});

// ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。
describe("addAlias / removeAlias", () => {
  it("別名を追加すると、その別名でもmaskNamesで同じIDへ変換される", async () => {
    const pd = await loadModule();
    const id = pd.registerName("田中さん");
    expect(pd.addAlias(id, "田中")).toEqual({ ok: true });
    expect(pd.maskNames("田中と話した")).toBe(`${id}と話した`);
    // 「田中さん」（正式名、4文字）は「田中」（別名、2文字）より長いため、
    // replaceAllAtOnceの「重なり合う候補は長い方を優先」により正式名側が一致する。
    expect(pd.maskNames("田中さんと話した")).toBe(`${id}と話した`);
  });

  it("listPeopleは別名を重複した人物としてではなく、正式名のaliasesとして返す", async () => {
    const pd = await loadModule();
    const id = pd.registerName("田中さん");
    pd.addAlias(id, "田中");
    expect(pd.listPeople()).toEqual([{ id, name: "田中さん", aliases: ["田中"] }]);
  });

  it("既に別の人物として登録済みの名前はエラーになる（統合を促す）", async () => {
    const pd = await loadModule();
    const idA = pd.registerName("Aさん");
    pd.registerName("Bさん");
    const result = pd.addAlias(idA, "Bさん");
    expect(result.ok).toBe(false);
  });

  it("正式名と同じ名前はエラーになる", async () => {
    const pd = await loadModule();
    const id = pd.registerName("Aさん");
    expect(pd.addAlias(id, "Aさん")).toEqual({ ok: false, error: "正式名と同じです" });
  });

  it("存在しない人物IDはエラーになる", async () => {
    const pd = await loadModule();
    expect(pd.addAlias("PERSON_999", "誰か")).toEqual({ ok: false, error: "対象の人物が見つかりません" });
  });

  it("removeAliasで別名を取り消せる。正式名はremoveAliasでは消せない", async () => {
    const pd = await loadModule();
    const id = pd.registerName("田中さん");
    pd.addAlias(id, "田中");
    expect(pd.removeAlias(id, "田中")).toBe(true);
    expect(pd.listPeople()[0].aliases).toEqual([]);
    expect(pd.removeAlias(id, "田中さん")).toBe(false);
  });

  it("deletePersonは正式名だけでなく別名もすべて削除する", async () => {
    const pd = await loadModule();
    const id = pd.registerName("田中さん");
    pd.addAlias(id, "田中");
    expect(pd.deletePerson(id)).toBe(true);
    expect(pd.getPersonId("田中")).toBeUndefined();
    expect(pd.getPersonId("田中さん")).toBeUndefined();
  });
});

// ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
describe("mergePersons", () => {
  it("統合元の正式名は統合先の別名になり、以後同じIDへマスクされる", async () => {
    const pd = await loadModule();
    const fromId = pd.registerName("たなかさん");
    const toId = pd.registerName("田中さん");
    expect(pd.mergePersons(fromId, toId)).toEqual({ ok: true });

    expect(pd.listPeople()).toEqual([{ id: toId, name: "田中さん", aliases: ["たなかさん"] }]);
    expect(pd.maskNames("たなかさんと話した")).toBe(`${toId}と話した`);
    expect(pd.unmaskNames(fromId)).toBe(fromId); // 統合元のIDはもう実名に戻らない
  });

  it("統合元が既に別名を持っていた場合、それも統合先の別名として引き継がれる", async () => {
    const pd = await loadModule();
    const fromId = pd.registerName("たなかさん");
    pd.addAlias(fromId, "Tanaka");
    const toId = pd.registerName("田中さん");
    pd.mergePersons(fromId, toId);
    expect(pd.listPeople()[0].aliases.sort()).toEqual(["Tanaka", "たなかさん"].sort());
  });

  it("同じ人物同士の統合はエラーになる", async () => {
    const pd = await loadModule();
    const id = pd.registerName("Aさん");
    expect(pd.mergePersons(id, id)).toEqual({ ok: false, error: "同じ人物です" });
  });

  it("存在しないIDを指定するとエラーになる", async () => {
    const pd = await loadModule();
    const id = pd.registerName("Aさん");
    expect(pd.mergePersons("PERSON_999", id)).toEqual({ ok: false, error: "統合元の人物が見つかりません" });
    expect(pd.mergePersons(id, "PERSON_999")).toEqual({ ok: false, error: "統合先の人物が見つかりません" });
  });
});

describe("assertNoRealNamesLeaked", () => {
  it("実名が含まれていなければ例外を投げない", async () => {
    const pd = await loadModule();
    pd.registerName("Aさん");
    expect(() => pd.assertNoRealNamesLeaked("PERSON_1と話した")).not.toThrow();
  });

  it("実名が1件でも残っていれば例外を投げる", async () => {
    const pd = await loadModule();
    pd.registerName("Aさん");
    expect(() => pd.assertNoRealNamesLeaked("Aさんと話した")).toThrow();
  });
});

describe("maskForStorage", () => {
  it("既知の名前をIDへ置換して返す", async () => {
    const pd = await loadModule();
    const id = pd.registerName("Aさん");
    const result = await pd.maskForStorage("Aさんと話した");
    expect(result).toBe(`${id}と話した`);
  });

  it("ローカルNERが新規名を検出しても自動登録しない", async () => {
    mockPeople = ["Bさん"];
    const pd = await loadModule();
    const result = await pd.maskForStorage("Bさんと1on1した");
    expect(result).toBe("Bさんと1on1した");
    expect(pd.listPeople()).toHaveLength(0);
  });
});

describe("detectUnregisteredNameCandidates / ensureNameCandidatesAllowed", () => {
  it("未登録の妥当な候補を返す", async () => {
    mockPeople = ["Bさん"];
    const pd = await loadModule();
    expect(await pd.detectUnregisteredNameCandidates("Bさんと1on1した")).toEqual(["Bさん"]);
  });

  it("登録済みの名前は候補に出さない", async () => {
    mockPeople = ["Bさん"];
    const pd = await loadModule();
    pd.registerName("Bさん");
    expect(await pd.detectUnregisteredNameCandidates("Bさんと1on1した")).toEqual([]);
  });

  it("予約語・英数字のみ・短すぎる候補は出さない", async () => {
    mockPeople = ["NPS", "1on1", "PR", "ABC123", "A"];
    const pd = await loadModule();
    expect(await pd.detectUnregisteredNameCandidates("NPSと1on1とPRとABC123とA")).toEqual([]);
  });

  it("未許可なら UnconfirmedNameCandidatesError を投げる", async () => {
    mockPeople = ["Bさん"];
    const pd = await loadModule();
    const { UnconfirmedNameCandidatesError } = await import("@/lib/name-candidate-confirmation");
    await expect(pd.ensureNameCandidatesAllowed(["Bさんと話した"])).rejects.toBeInstanceOf(
      UnconfirmedNameCandidatesError,
    );
  });

  it("許可すると acknowledge し、再検出されない", async () => {
    mockPeople = ["Bさん"];
    const pd = await loadModule();
    await pd.ensureNameCandidatesAllowed(["Bさんと話した"], { allowUnmaskedCandidates: true });
    expect(pd.isAcknowledgedUnmasked("Bさん")).toBe(true);
    expect(await pd.detectUnregisteredNameCandidates("Bさんと話した")).toEqual([]);
    expect(pd.listPeople()).toHaveLength(0);
  });

  it("registerNameCandidates で候補を人名登録する", async () => {
    mockPeople = ["Bさん"];
    const pd = await loadModule();
    await pd.ensureNameCandidatesAllowed(["Bさんと話した"], { registerNameCandidates: true });
    expect(pd.listPeople()).toEqual([{ id: "PERSON_1", name: "Bさん", aliases: [] }]);
    expect(await pd.detectUnregisteredNameCandidates("Bさんと話した")).toEqual([]);
    expect(pd.maskNames("Bくんと話した")).toBe("PERSON_1と話した");
  });

  it("登録済みと敬称だけ違う候補は未登録扱いしない", async () => {
    mockPeople = ["田中くん"];
    const pd = await loadModule();
    pd.registerName("田中さん");
    expect(await pd.detectUnregisteredNameCandidates("田中くんと話した")).toEqual([]);
  });
});

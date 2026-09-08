import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

// maskForStorage()はローカルNERモデル（local-model.ts、実際にはONNXモデルをロードする）を
// 経由して新規の人物名を検出するため、テストでは実モデルを使わずに固定応答を返すモックに
// 差し替える。detectAndRegisterNamesはextractFirstJsonObject(runLocalChatの戻り値)を
// パースするだけなので、モック側でそのまま有効なJSON文字列を返せばよい。
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
    pd.registerName("A");
    const idFull = pd.registerName("Aさん");
    expect(pd.maskNames("Aさんに会った")).toBe(`${idFull}に会った`);
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
        { id: "PERSON_1", name: "Aさん" },
        { id: "PERSON_2", name: "Bさん" },
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

  it("ローカルNERが新規名を検出した場合は登録してマスクする", async () => {
    mockPeople = ["Bさん"];
    const pd = await loadModule();
    const result = await pd.maskForStorage("Bさんと1on1した");
    expect(result).toBe("PERSON_1と1on1した");
    expect(pd.listPeople()).toEqual([{ id: "PERSON_1", name: "Bさん" }]);
  });

  it("予約語（NPS, 1on1等）はNER検出結果でも登録しない", async () => {
    mockPeople = ["NPS", "1on1", "PR"];
    const pd = await loadModule();
    await pd.maskForStorage("NPSと1on1とPRの話をした");
    expect(pd.listPeople()).toHaveLength(0);
  });

  it("英数字のみの短い候補は人物名として扱わない", async () => {
    mockPeople = ["ABC123"];
    const pd = await loadModule();
    await pd.maskForStorage("ABC123について話した");
    expect(pd.listPeople()).toHaveLength(0);
  });

  it("1文字の候補は最小長未満のため登録しない", async () => {
    mockPeople = ["A"];
    const pd = await loadModule();
    await pd.maskForStorage("Aと話した");
    expect(pd.listPeople()).toHaveLength(0);
  });
});

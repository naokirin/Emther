import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "./test-helpers/store-env";

// maskForStorage()は候補検出を経由せず既知名のマスクのみ行う。
// 候補検出の敬称ルールは実コードを通し、kuromoji 辞書ロードだけ避ける
// （形態素POSの検証は mask-check*.test.ts 側）。
vi.mock("./local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("./embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

vi.mock("./mask-check-morph", () => ({
  ensureNameMorphReady: async () => {},
  detectMorphPersonNames: () => [] as string[],
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
  return import("./people-directory");
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

  it("findMentionedPersonIdsは本文中の登録済み名を敬称揺れ込みで返す（未登録は含めない）", async () => {
    const pd = await loadModule();
    const tanaka = pd.registerName("田中さん");
    const sato = pd.registerName("佐藤さん");
    expect(pd.findMentionedPersonIds("田中くんと佐藤さんで話した。未登録太郎は名簿に無い")).toEqual([tanaka, sato]);
    expect(pd.findMentionedPersonIds("")).toEqual([]);
    expect(pd.findMentionedPersonIds("誰の名前も出てこないメモ")).toEqual([]);
  });

  it("findMentionedPersonIdsは長い登録名を短い登録名のprefixより優先する", async () => {
    const pd = await loadModule();
    pd.registerName("山田");
    const idFull = pd.registerName("山田太郎");
    expect(pd.findMentionedPersonIds("山田太郎に会った")).toEqual([idFull]);
  });

  it("maskNamesは登録時と異なる敬称でも同じIDへ置換する", async () => {
    const pd = await loadModule();
    const id = pd.registerName("田中さん");
    expect(pd.maskNames("田中くんと話した")).toBe(`${pd.formatPersonToken(id)}と話した`);
    expect(pd.maskNames("田中と話した")).toBe(`${pd.formatPersonToken(id)}と話した`);
  });

  it("getPersonIdは敬称違いでも同一人物を返す", async () => {
    const pd = await loadModule();
    const id = pd.registerName("田中さん");
    expect(pd.getPersonId("田中くん")).toBe(id);
    expect(pd.getPersonId("田中")).toBe(id);
  });

  it("maskNamesは登録済みの名前を区切り付きトークンに置換する", async () => {
    const pd = await loadModule();
    const id = pd.registerName("Aさん");
    expect(pd.maskNames(`${"Aさん"}と話した`)).toBe(`${pd.formatPersonToken(id)}と話した`);
  });

  it("unmaskNamesは区切り付きトークンと裸IDの両方を実名に戻す", async () => {
    const pd = await loadModule();
    const id = pd.registerName("Aさん");
    expect(pd.unmaskNames(`${pd.formatPersonToken(id)}と話した`)).toBe("Aさんと話した");
    expect(pd.unmaskNames(`${id}と話した`)).toBe("Aさんと話した");
  });

  it("長い名前が短い名前のprefixになっていても最長一致を優先する", async () => {
    const pd = await loadModule();
    pd.registerName("山田");
    const idFull = pd.registerName("山田太郎");
    expect(pd.maskNames("山田太郎に会った")).toBe(`${pd.formatPersonToken(idFull)}に会った`);
  });

  it("PERSON_1とPERSON_10のように短いIDが長いIDのprefixでも壊れず復元できる", async () => {
    const pd = await loadModule();
    for (let i = 0; i < 9; i++) pd.registerName(`人物${i}`);
    const id10 = pd.registerName("10番目の人");
    expect(id10).toBe("PERSON_10");
    expect(pd.unmaskNames(`${id10}が来た`)).toBe("10番目の人が来た");
    expect(pd.unmaskNames(`${pd.formatPersonToken(id10)}が来た`)).toBe("10番目の人が来た");
  });

  it("対応表に無い裸IDは、短い既登録IDへの部分一致で別人の名前に化けさせず未解決のまま残す", async () => {
    // ユーザー指摘の再現: カウンタのリセット等でPERSON_1のみ登録された状態で、
    // 本文中に(存在しない)PERSON_10が残っていても「田中さん0」のような誤帰属をしない。
    const pd = await loadModule();
    const id1 = pd.registerName("田中さん");
    expect(id1).toBe("PERSON_1");
    expect(pd.unmaskNames("PERSON_10が発生した")).toBe("PERSON_10が発生した");
    expect(pd.unmaskNames("PERSON_1が発生した")).toBe("田中さんが発生した");
  });

  it("PERSON_1の直後に数字が続いてもPERSON_17と誤って復元しない", async () => {
    const pd = await loadModule();
    const id1 = pd.registerName("田中さん");
    for (let i = 0; i < 15; i++) pd.registerName(`人物${i}`);
    const id17 = pd.registerName("鈴木さん");
    expect(id1).toBe("PERSON_1");
    expect(id17).toBe("PERSON_17");

    const masked = pd.maskNames("月曜は田中さん7回忌で休暇予定");
    expect(masked).toBe(`月曜は${pd.formatPersonToken(id1)}7回忌で休暇予定`);
    expect(masked).not.toContain(pd.formatPersonToken(id17));
    expect(pd.unmaskNames(masked)).toBe("月曜は田中さん7回忌で休暇予定");
  });
});

describe("empty persist guard", () => {
  it("空メモリからのpersistはディスク上の名簿を消さない", async () => {
    const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const secureDir = process.env.EM_SECURE_DATA_DIR!;
    mkdirSync(secureDir, { recursive: true });
    const path = join(secureDir, "people-directory.json");

    const pd = await loadModule();
    expect(pd.listPeople()).toEqual([]);

    writeFileSync(
      path,
      JSON.stringify({ entries: [["花子さん", "PERSON_1"]], counter: 1, acknowledgedUnmasked: [] }),
      "utf8",
    );

    pd.acknowledgeUnmaskedCandidates(["試験語"]);

    expect(pd.unmaskNames("PERSON_1")).toBe("花子さん");
    expect(JSON.parse(readFileSync(path, "utf8")).entries).toEqual([["花子さん", "PERSON_1"]]);
  });

  it("deletePersonで最後の1人を消した場合は空保存を許可する", async () => {
    const pd = await loadModule();
    const id = pd.registerName("花子さん");
    expect(pd.deletePerson(id)).toBe(true);
    expect(pd.listPeople()).toEqual([]);
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
    expect(pd.maskNames("田中と話した")).toBe(`${pd.formatPersonToken(id)}と話した`);
    // 「田中さん」（正式名、4文字）は「田中」（別名、2文字）より長いため、
    // replaceAllAtOnceの「重なり合う候補は長い方を優先」により正式名側が一致する。
    expect(pd.maskNames("田中さんと話した")).toBe(`${pd.formatPersonToken(id)}と話した`);
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

describe("renamePerson", () => {
  it("正式名を差し替え、旧名は別名として残る", async () => {
    const pd = await loadModule();
    const id = pd.registerName("田中さん");
    expect(pd.renamePerson(id, "田中")).toEqual({ ok: true });
    expect(pd.listPeople()).toEqual([{ id, name: "田中", aliases: ["田中さん"] }]);
    expect(pd.maskNames("田中さんと話した")).toBe(`${pd.formatPersonToken(id)}と話した`);
    expect(pd.unmaskNames(id)).toBe("田中");
  });

  it("既に別の人物の名前には変更できない", async () => {
    const pd = await loadModule();
    const id = pd.registerName("田中さん");
    pd.registerName("佐藤さん");
    expect(pd.renamePerson(id, "佐藤さん")).toEqual({
      ok: false,
      error: "この名前は既に別の人物として登録されています。「重複を統合」を使ってください。",
    });
  });

  // ユーザー指摘「勝手にメンバーのプライマリの名前が変わる」対応の回帰テスト。
  // 以前は永続化ファイルの並び順（entriesの最初の出現）から正式名を推測していたため、
  // 明示改名の後に別名を1件追加しただけで、プロセス再起動時に正式名が改名前へ戻って
  // しまっていた。
  it("改名後に別名を追加しても、再読み込み（プロセス再起動相当）で正式名が改名前へ戻らない", async () => {
    const pd1 = await loadModule();
    const id = pd1.registerName("田中太郎");
    expect(pd1.renamePerson(id, "田中一郎")).toEqual({ ok: true });
    expect(pd1.addAlias(id, "たなかさん")).toEqual({ ok: true });

    vi.resetModules();
    const pd2 = await loadModule();

    expect(pd2.listPeople()).toEqual(
      expect.arrayContaining([{ id, name: "田中一郎", aliases: expect.arrayContaining(["田中太郎", "たなかさん"]) }]),
    );
    expect(pd2.unmaskNames(id)).toBe("田中一郎");
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
    expect(pd.maskNames("たなかさんと話した")).toBe(`${pd.formatPersonToken(toId)}と話した`);
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

describe("detectLeakedNames", () => {
  it("実名が含まれていなければ空配列を返す", async () => {
    const pd = await loadModule();
    pd.registerName("Aさん");
    expect(pd.detectLeakedNames("PERSON_1と話した")).toEqual([]);
  });

  it("ヒットした登録名（表記揺れ含む）をすべて返す（例外は投げない）", async () => {
    const pd = await loadModule();
    pd.registerName("Aさん");
    pd.registerName("Bさん");
    const hits = pd.detectLeakedNames("AさんとBさんが話した");
    expect(hits.sort()).toEqual(["Aさん", "Bさん"]);
  });
});

describe("maskForStorage", () => {
  it("既知の名前をIDへ置換して返す", async () => {
    const pd = await loadModule();
    const id = pd.registerName("Aさん");
    const result = await pd.maskForStorage("Aさんと話した");
    expect(result).toBe(`${pd.formatPersonToken(id)}と話した`);
  });

  it("候補検出があっても maskForStorage 単体では自動登録しない", async () => {
    const pd = await loadModule();
    const result = await pd.maskForStorage("田中さんと1on1した");
    expect(result).toBe("田中さんと1on1した");
    expect(pd.listPeople()).toHaveLength(0);
  });
});

describe("detectUnregisteredNameCandidates / ensureNameCandidatesAllowed", () => {
  it("未登録の妥当な候補を返す", async () => {
    const pd = await loadModule();
    expect(await pd.detectUnregisteredNameCandidates("田中さんと1on1した")).toEqual(["田中さん"]);
  });

  it("登録済みの名前は候補に出さない", async () => {
    const pd = await loadModule();
    pd.registerName("田中さん");
    expect(await pd.detectUnregisteredNameCandidates("田中さんと1on1した")).toEqual([]);
  });

  it("予約語・英数字のみ・短すぎる候補は出さない", async () => {
    const pd = await loadModule();
    expect(await pd.detectUnregisteredNameCandidates("NPSと1on1とPRとABC123とA")).toEqual([]);
  });

  it("既定では候補検出を呼ばず通過する（事前登録が正）", async () => {
    const pd = await loadModule();
    const spy = vi.spyOn(pd, "detectUnregisteredNameCandidates");
    await pd.ensureNameCandidatesAllowed(["田中さんと話した"]);
    expect(spy).not.toHaveBeenCalled();
    expect(pd.listPeople()).toHaveLength(0);
  });

  it("allowUnmaskedCandidates:false なら UnconfirmedNameCandidatesError を投げる", async () => {
    const pd = await loadModule();
    const { UnconfirmedNameCandidatesError } = await import("./name-candidate-confirmation");
    await expect(
      pd.ensureNameCandidatesAllowed(["田中さんと話した"], { allowUnmaskedCandidates: false }),
    ).rejects.toBeInstanceOf(UnconfirmedNameCandidatesError);
  });

  it("厳格確認時、複数テキストは結合して1回の検出にまとめる", async () => {
    const detect = await import("./name-candidate-detect");
    const spy = vi.spyOn(detect, "detectNameCandidatesAsync");
    const pd = await loadModule();
    await pd.ensureNameCandidatesAllowed(
      ["田中さんと話した", "内容の文", "方法の文"],
      { allowUnmaskedCandidates: true },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain("田中さんと話した");
    expect(pd.isAcknowledgedUnmasked("田中さん")).toBe(true);
  });

  it("許可すると acknowledge し、再検出されない", async () => {
    const pd = await loadModule();
    await pd.ensureNameCandidatesAllowed(["田中さんと話した"], { allowUnmaskedCandidates: true });
    expect(pd.isAcknowledgedUnmasked("田中さん")).toBe(true);
    expect(await pd.detectUnregisteredNameCandidates("田中さんと話した")).toEqual([]);
    expect(pd.listPeople()).toHaveLength(0);
  });

  it("registerNameCandidates で候補を人名登録する", async () => {
    const pd = await loadModule();
    await pd.ensureNameCandidatesAllowed(["田中さんと話した"], { registerNameCandidates: true });
    expect(pd.listPeople()).toEqual([{ id: "PERSON_1", name: "田中さん", aliases: [] }]);
    expect(await pd.detectUnregisteredNameCandidates("田中さんと話した")).toEqual([]);
    expect(pd.maskNames("田中くんと話した")).toBe("{{PERSON_1}}と話した");
  });

  it("additionalCandidates は形態素検出と合流して同じゲートで扱われる", async () => {
    const pd = await loadModule();
    const { UnconfirmedNameCandidatesError } = await import("./name-candidate-confirmation");
    // 形態素モックが空でも、LLM抽出由来の追加候補だけでブロックできる。
    await expect(
      pd.ensureNameCandidatesAllowed(["特に名前のないメモ"], { allowUnmaskedCandidates: false }, ["山田花子"]),
    ).rejects.toBeInstanceOf(UnconfirmedNameCandidatesError);
    await pd.ensureNameCandidatesAllowed(["特に名前のないメモ"], { allowUnmaskedCandidates: true }, ["山田花子"]);
    expect(pd.isAcknowledgedUnmasked("山田花子")).toBe(true);
  });

  it("登録済みと敬称だけ違う候補は未登録扱いしない", async () => {
    const pd = await loadModule();
    pd.registerName("田中さん");
    expect(await pd.detectUnregisteredNameCandidates("田中くんと話した")).toEqual([]);
  });

  it("「皆疲れている様子。」などの動詞語尾＋様態表現は人名候補として検出されない", async () => {
    const pd = await loadModule();
    expect(await pd.detectUnregisteredNameCandidates("皆疲れている様子。")).toEqual([]);
    expect(await pd.detectUnregisteredNameCandidates("対応が進められている様を確認した。")).toEqual([]);
  });

  it("isInvalidPersonNameEntry はひらがなストップワードや動詞語尾を無効と判定する", async () => {
    const pd = await loadModule();
    expect(pd.isInvalidPersonNameEntry("れている様")).toBe(true);
    expect(pd.isInvalidPersonNameEntry("ているさん")).toBe(true);
    expect(pd.isInvalidPersonNameEntry("できる様")).toBe(true);
    expect(pd.isInvalidPersonNameEntry("田中さん")).toBe(false);
    expect(pd.isInvalidPersonNameEntry("佐藤")).toBe(false);
  });

  it("isSafeBareNameForMask は動詞語尾やストップワードをbareマスク辞書から除外する", async () => {
    const pd = await loadModule();
    expect(pd.isSafeBareNameForMask("れている")).toBe(false);
    expect(pd.isSafeBareNameForMask("ている")).toBe(false);
    expect(pd.isSafeBareNameForMask("こちら")).toBe(false);
    expect(pd.isSafeBareNameForMask("田中")).toBe(true);
    expect(pd.isSafeBareNameForMask("佐藤")).toBe(true);
  });

  it("registerName は無効な人名（動詞語尾・ストップワード）の登録を拒否する", async () => {
    const pd = await loadModule();
    expect(() => pd.registerName("れている様")).toThrow("無効な人名候補");
  });
});

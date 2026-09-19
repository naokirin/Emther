import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

type LookupTopic = { topic: string; isPrimarySource: boolean; note?: string };
type LookupResult = { topic: string; url?: string };
const findReferenceUrlsMock = vi.fn<(topics: LookupTopic[]) => Promise<LookupResult[]>>();
vi.mock("@/lib/reference-lookup", () => ({
  findReferenceUrls: (topics: LookupTopic[]) => findReferenceUrlsMock(topics),
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  findReferenceUrlsMock.mockReset();
  findReferenceUrlsMock.mockResolvedValue([]);
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModule() {
  return import("@/lib/em-growth-store");
}

describe("em-growth-store", () => {
  it("createGrowSuggestionsは新規idと既定statusを付けて保存する", async () => {
    const store = await loadModule();
    const created = store.createGrowSuggestions(
      [
        { title: "学びA", rationale: "根拠A", references: [] },
        { title: "学びB", rationale: "根拠B", evidenceSummary: "要約B", references: [{ topic: "コーチング", isPrimarySource: false }] },
      ],
      { sourceRunId: "run-1" },
    );
    expect(created).toHaveLength(2);
    for (const s of created) {
      expect(s.id).toBeTruthy();
      expect(s.status).toBe("unread");
      expect(s.sourceRunId).toBe("run-1");
      expect(s.weekKey).toMatch(/^\d{4}-W\d{2}$/);
    }
    expect(store.listGrowSuggestions()).toHaveLength(2);
  });

  it("listGrowSuggestionsは新しい順で返す", async () => {
    const store = await loadModule();
    store.createGrowSuggestions([{ title: "古い", rationale: "r", references: [] }], { now: 1000 });
    store.createGrowSuggestions([{ title: "新しい", rationale: "r", references: [] }], { now: 2000 });
    const list = store.listGrowSuggestions();
    expect(list.map((s) => s.title)).toEqual(["新しい", "古い"]);
  });

  it("setGrowSuggestionStatusでstatusを更新できる", async () => {
    const store = await loadModule();
    const [created] = store.createGrowSuggestions([{ title: "学びA", rationale: "根拠A", references: [] }]);
    const updated = store.setGrowSuggestionStatus(created.id, "acknowledged");
    expect(updated?.status).toBe("acknowledged");
    expect(store.getGrowSuggestion(created.id)?.status).toBe("acknowledged");
  });

  it("setGrowSuggestionStatusは存在しないidに対してundefinedを返す", async () => {
    const store = await loadModule();
    expect(store.setGrowSuggestionStatus("no-such-id", "dismissed")).toBeUndefined();
  });

  it("toGrowSuggestionViewはPERSON_n IDを実名に復元する", async () => {
    const peopleDirectory = await import("@core/people-directory");
    const store = await loadModule();
    const personId = peopleDirectory.registerName("Aさん");
    const [created] = store.createGrowSuggestions([
      {
        title: `${personId}との1on1の傾向から`,
        rationale: `${personId}との対話パターンが繰り返し観測される`,
        evidenceSummary: `${personId}に関するメモ`,
        references: [{ topic: "コーチング", isPrimarySource: false, note: `${personId}向けの参考` }],
      },
    ]);
    const view = store.toGrowSuggestionView(created);
    expect(view.title).toBe("Aさんとの1on1の傾向から");
    expect(view.rationale).toBe("Aさんとの対話パターンが繰り返し観測される");
    expect(view.evidenceSummary).toBe("Aさんに関するメモ");
    expect(view.references[0].note).toBe("Aさん向けの参考");
  });

  it("enrichGrowSuggestionReferencesはurl未設定の参照だけをまとめてWebSearchで補完する", async () => {
    const store = await loadModule();
    findReferenceUrlsMock.mockResolvedValue([
      { topic: "コーチング", url: "https://example.com/coaching" },
      // 「見つからないトピック」はurl無しで返ってくる（＝見つからなかった）ケースを模す。
      { topic: "見つからないトピック" },
    ]);
    const [created] = store.createGrowSuggestions([
      {
        title: "学びA",
        rationale: "根拠A",
        references: [
          { topic: "コーチング", isPrimarySource: false },
          { topic: "既にurlあり", isPrimarySource: false, url: "https://example.com/existing" },
          { topic: "見つからないトピック", isPrimarySource: false },
        ],
      },
    ]);

    await store.enrichGrowSuggestionReferences([created]);

    // 既にurlがある参照は問い合わせ対象から除外し、未設定の2件だけをまとめて1回で問い合わせる。
    expect(findReferenceUrlsMock).toHaveBeenCalledTimes(1);
    expect(findReferenceUrlsMock).toHaveBeenCalledWith([
      { topic: "コーチング", isPrimarySource: false, note: undefined },
      { topic: "見つからないトピック", isPrimarySource: false, note: undefined },
    ]);

    const updated = store.getGrowSuggestion(created.id);
    expect(updated?.references).toEqual([
      { topic: "コーチング", isPrimarySource: false, url: "https://example.com/coaching" },
      { topic: "既にurlあり", isPrimarySource: false, url: "https://example.com/existing" },
      { topic: "見つからないトピック", isPrimarySource: false },
    ]);
  });

  it("enrichGrowSuggestionReferencesはどの参照も補完できなければ永続化を再実行しない", async () => {
    const store = await loadModule();
    findReferenceUrlsMock.mockResolvedValue([{ topic: "見つからない" }]);
    const [created] = store.createGrowSuggestions([
      { title: "学びA", rationale: "根拠A", references: [{ topic: "見つからない", isPrimarySource: false }] },
    ]);
    await store.enrichGrowSuggestionReferences([created]);
    const updated = store.getGrowSuggestion(created.id);
    expect(updated?.references).toEqual([{ topic: "見つからない", isPrimarySource: false }]);
  });

  it("enrichGrowSuggestionReferencesはurl未設定の参照が無ければ問い合わせ自体を行わない", async () => {
    const store = await loadModule();
    const [created] = store.createGrowSuggestions([
      {
        title: "学びA",
        rationale: "根拠A",
        references: [{ topic: "既にurlあり", isPrimarySource: false, url: "https://example.com/existing" }],
      },
    ]);
    await store.enrichGrowSuggestionReferences([created]);
    expect(findReferenceUrlsMock).not.toHaveBeenCalled();
  });
});

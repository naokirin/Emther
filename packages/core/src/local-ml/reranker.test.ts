import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../settings-store", () => ({
  getRulesAndConstraints: vi.fn(() => ({ localRerankEnabled: false })),
}));

vi.mock("@huggingface/transformers", () => ({
  env: { cacheDir: "", useFSCache: false },
  AutoTokenizer: { from_pretrained: vi.fn() },
  AutoModelForSequenceClassification: { from_pretrained: vi.fn() },
}));

describe("reranker maybeRerankByText", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("設定OFFなら入力順のまま返す", async () => {
    const settings = await import("../settings-store");
    vi.mocked(settings.getRulesAndConstraints).mockReturnValue({ localRerankEnabled: false } as never);
    const { maybeRerankByText } = await import("./reranker");
    const items = [{ id: "a" }, { id: "b" }];
    const out = await maybeRerankByText("q", items, (x) => x.id);
    expect(out).toEqual(items);
  });

  it("設定ONでスコア順に並べ替える", async () => {
    const settings = await import("../settings-store");
    vi.mocked(settings.getRulesAndConstraints).mockReturnValue({ localRerankEnabled: true } as never);

    const transformers = await import("@huggingface/transformers");
    vi.mocked(transformers.AutoTokenizer.from_pretrained).mockResolvedValue(
      (() => ({})) as never,
    );
    vi.mocked(transformers.AutoModelForSequenceClassification.from_pretrained).mockResolvedValue(
      (async () => ({ logits: { data: new Float32Array([1.0, 5.0, 2.0]) } })) as never,
    );

    const { clearRerankerCache, maybeRerankByText } = await import("./reranker");
    clearRerankerCache();
    const items = [{ id: "low" }, { id: "high" }, { id: "mid" }];
    const out = await maybeRerankByText("query", items, (x) => x.id);
    expect(out.map((x) => x.id)).toEqual(["high", "mid", "low"]);
  });

  it("スコア取得失敗時は元の順にフォールバックする", async () => {
    const settings = await import("../settings-store");
    vi.mocked(settings.getRulesAndConstraints).mockReturnValue({ localRerankEnabled: true } as never);

    const transformers = await import("@huggingface/transformers");
    vi.mocked(transformers.AutoTokenizer.from_pretrained).mockRejectedValue(new Error("download failed"));

    const { clearRerankerCache, maybeRerankByText } = await import("./reranker");
    clearRerankerCache();
    const items = [{ id: "a" }, { id: "b" }];
    const out = await maybeRerankByText("q", items, (x) => x.id);
    expect(out).toEqual(items);
  });

  it("getText が非文字列でも throw せずフォールバックする", async () => {
    const settings = await import("../settings-store");
    vi.mocked(settings.getRulesAndConstraints).mockReturnValue({ localRerankEnabled: true } as never);

    const transformers = await import("@huggingface/transformers");
    vi.mocked(transformers.AutoTokenizer.from_pretrained).mockResolvedValue(
      (() => ({})) as never,
    );
    vi.mocked(transformers.AutoModelForSequenceClassification.from_pretrained).mockResolvedValue(
      (async () => ({ logits: { data: new Float32Array([1, 2, 3]) } })) as never,
    );

    const { clearRerankerCache, maybeRerankByText } = await import("./reranker");
    clearRerankerCache();
    const items = [{ t: "a" as string | undefined }, { t: undefined }, { t: "b" }];
    const out = await maybeRerankByText("q", items, (i) => i.t as string);
    expect(out).toHaveLength(3);
  });

  it("既定は fp32 を先にロードする", async () => {
    const settings = await import("../settings-store");
    vi.mocked(settings.getRulesAndConstraints).mockReturnValue({ localRerankEnabled: true } as never);

    const transformers = await import("@huggingface/transformers");
    vi.mocked(transformers.AutoTokenizer.from_pretrained).mockResolvedValue(
      (() => ({})) as never,
    );
    vi.mocked(transformers.AutoModelForSequenceClassification.from_pretrained).mockResolvedValue(
      (async () => ({ logits: { data: new Float32Array([0.1, 0.9]) } })) as never,
    );

    const { clearRerankerCache, maybeRerankByText, RERANKER_MODEL } = await import("./reranker");
    expect(RERANKER_MODEL.dtypes[0]).toBe("fp32");
    clearRerankerCache();
    const items = [{ id: "a" }, { id: "b" }];
    const out = await maybeRerankByText("q", items, (x) => x.id);
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
    expect(transformers.AutoModelForSequenceClassification.from_pretrained).toHaveBeenCalledWith(
      RERANKER_MODEL.id,
      expect.objectContaining({ dtype: "fp32" }),
    );
  });

  it("先頭 dtype が失敗したら次の dtype を試す", async () => {
    const settings = await import("../settings-store");
    vi.mocked(settings.getRulesAndConstraints).mockReturnValue({ localRerankEnabled: true } as never);

    const transformers = await import("@huggingface/transformers");
    vi.mocked(transformers.AutoTokenizer.from_pretrained).mockResolvedValue(
      (() => ({})) as never,
    );
    vi.mocked(transformers.AutoModelForSequenceClassification.from_pretrained)
      .mockRejectedValueOnce(new Error("fp32 missing"))
      .mockResolvedValueOnce((async () => ({ logits: { data: new Float32Array([2, 1]) } })) as never);

    const { clearRerankerCache, maybeRerankByText, RERANKER_MODEL } = await import("./reranker");
    clearRerankerCache();
    const items = [{ id: "a" }, { id: "b" }];
    const out = await maybeRerankByText("q", items, (x) => x.id);
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
    expect(transformers.AutoModelForSequenceClassification.from_pretrained).toHaveBeenCalledTimes(2);
    expect(transformers.AutoModelForSequenceClassification.from_pretrained).toHaveBeenNthCalledWith(
      1,
      RERANKER_MODEL.id,
      expect.objectContaining({ dtype: "fp32" }),
    );
    expect(transformers.AutoModelForSequenceClassification.from_pretrained).toHaveBeenNthCalledWith(
      2,
      RERANKER_MODEL.id,
      expect.objectContaining({ dtype: "q8" }),
    );
  });
});

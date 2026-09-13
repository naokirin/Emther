import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

let mockChatResponse = JSON.stringify({ findings: [], people: [] });
vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => mockChatResponse),
  extractFirstJsonObject: (text: string) => {
    const start = text.indexOf("{");
    if (start === -1) return undefined;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return undefined;
  },
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  mockChatResponse = JSON.stringify({ findings: [], people: [] });
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("detectSensitiveByRules", () => {
  it("メール・電話・APIキーっぽい文字列を検出する", async () => {
    const { detectSensitiveByRules } = await import("@/lib/mask-check");
    const findings = detectSensitiveByRules(
      "連絡先は user@example.com / 090-1234-5678。鍵は sk-abcdefghijklmnopqrstuvwxyz0123456789",
    );
    const cats = findings.map((f) => f.category);
    expect(cats).toContain("email");
    expect(cats).toContain("phone");
    expect(cats).toContain("api_key_like");
    expect(findings.every((f) => f.source === "rule")).toBe(true);
  });

  it("URLクエリの token を url_secret として検出する", async () => {
    const { detectSensitiveByRules } = await import("@/lib/mask-check");
    const findings = detectSensitiveByRules("https://example.com/cb?token=abc123&x=1");
    expect(findings.some((f) => f.category === "url_secret")).toBe(true);
  });
});

describe("runMaskCheckQuick", () => {
  it("登録済み人名をマスクし置換一覧を返す（登録は増えない）", async () => {
    const pd = await import("@/lib/people-directory");
    pd.registerName("花子さん");
    const before = pd.listPeople().length;

    const { runMaskCheckQuick } = await import("@/lib/mask-check");
    const result = runMaskCheckQuick("花子さんと user@example.com で話した");

    expect(result.maskedText).toContain("PERSON_");
    expect(result.maskedText).not.toContain("花子さん");
    expect(result.nameReplacements.some((r) => r.from.includes("花子"))).toBe(true);
    expect(result.sensitiveFindings.some((f) => f.category === "email")).toBe(true);
    expect(pd.listPeople().length).toBe(before);
  });
});

describe("runMaskCheckAi", () => {
  it("ローカルAIの findings / people を返し、人名を登録しない", async () => {
    mockChatResponse = JSON.stringify({
      findings: [{ category: "health", excerpt: "体調不良で休み" }],
      people: ["次郎さん"],
    });
    const pd = await import("@/lib/people-directory");
    const before = pd.listPeople().length;

    const { runMaskCheckAi } = await import("@/lib/mask-check");
    const result = await runMaskCheckAi("次郎さんが体調不良で休み");

    expect(result.sensitiveFindings).toEqual([
      { category: "health", excerpt: "体調不良で休み", source: "local-ai" },
    ]);
    expect(result.unregisteredNameCandidates).toContain("次郎さん");
    expect(pd.listPeople().length).toBe(before);
    expect(pd.getPersonId("次郎さん")).toBeUndefined();
  });

  it("登録済みの人名は未登録候補に出さない", async () => {
    mockChatResponse = JSON.stringify({
      findings: [],
      people: ["花子さん"],
    });
    const pd = await import("@/lib/people-directory");
    pd.registerName("花子さん");

    const { runMaskCheckAi } = await import("@/lib/mask-check");
    const result = await runMaskCheckAi("花子さんの件");
    expect(result.unregisteredNameCandidates).toEqual([]);
  });
});

describe("previewNameMask", () => {
  it("同一表記の出現回数を数える", async () => {
    const pd = await import("@/lib/people-directory");
    const id = pd.registerName("太郎さん");
    const preview = pd.previewNameMask("太郎さんと太郎さんが同席");
    expect(preview.maskedText).toBe(`${id}と${id}が同席`);
    expect(preview.replacements).toEqual([{ from: "太郎さん", to: id, count: 2 }]);
  });
});

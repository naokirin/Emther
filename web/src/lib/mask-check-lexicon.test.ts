import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ findings: [], people: [] })),
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
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

/**
 * TUNING 語彙（検証サンプル由来）の回帰。
 * コアエンジンの一般仕様ではなく、積み上げた除外・言い回しの固定用。
 */
describe("mask-check TUNING lexicon", () => {
  it("TUNING の長い機微言い回しを検出する", async () => {
    const { detectSensitiveByRules } = await import("@/lib/mask-check");
    const findings = detectSensitiveByRules(
      "セキュリティインシデントで不正利用とアクセスを遮断した。被害拡大を防ぐ。",
    );
    expect(findings.some((f) => f.match.includes("セキュリティインシデント"))).toBe(true);
    expect(findings.some((f) => f.match.includes("不正利用"))).toBe(true);
    expect(findings.some((f) => f.match.includes("被害拡大"))).toBe(true);
  });

  it("TUNING のカタカナ一般語を人名候補から除外する", async () => {
    const { detectNameCandidates } = await import("@/lib/mask-check");
    const names = detectNameCandidates(
      "テスト環境にコピーしたサンプル。パートナーとの打ち合わせ。テーブル定義とログイン後の画面。",
    );
    expect(names).not.toContain("テスト");
    expect(names).not.toContain("コピー");
    expect(names).not.toContain("サンプル");
    expect(names).not.toContain("パートナー");
    expect(names).not.toContain("テーブル");
    expect(names).not.toContain("ログイン");
  });

  it("TUNING のひらがな文脈（のアカウント）で人名を拾う", async () => {
    const { detectNameCandidates } = await import("@/lib/mask-check");
    const names = detectNameCandidates("ただとしのアカウントが不正利用された。");
    expect(names).toContain("ただとし");
  });
});

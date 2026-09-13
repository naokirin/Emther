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
 * TUNING 縮小後の回帰。
 * 機微キーワードは CORE 核に寄せ、人名まわりの stopword / lookahead は TUNING に残す。
 */
describe("mask-check TUNING lexicon (shrunk keywords)", () => {
  it("長いインシデント言い回しはキーワードとして検出しない（CORE 核のみ）", async () => {
    const { detectSensitiveByRules } = await import("@/lib/mask-check");
    const findings = detectSensitiveByRules(
      "セキュリティインシデントで不正利用とアクセスを遮断した。被害拡大を防ぐ。",
    );
    expect(findings.some((f) => f.match.includes("セキュリティインシデント"))).toBe(false);
    expect(findings.some((f) => f.match.includes("不正利用"))).toBe(false);
    expect(findings.some((f) => f.match.includes("被害拡大"))).toBe(false);
  });

  it("CORE の不正アクセスと個人情報・漏洩は検出する", async () => {
    const { detectSensitiveByRules } = await import("@/lib/mask-check");
    const findings = detectSensitiveByRules(
      "個人情報の漏洩と不正アクセスが疑われる。apiキーは別管理。",
    );
    expect(findings.some((f) => f.match.includes("個人情報"))).toBe(true);
    expect(findings.some((f) => f.match.includes("漏洩"))).toBe(true);
    expect(findings.some((f) => f.match.includes("不正アクセス"))).toBe(true);
    expect(findings.some((f) => /apiキー/i.test(f.match))).toBe(true);
  });

  it("TUNING のカタカナ一般語を人名候補から除外する", async () => {
    const { detectNameCandidatesAsync } = await import("@/lib/mask-check");
    const names = await detectNameCandidatesAsync(
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
    const { detectNameCandidatesAsync } = await import("@/lib/mask-check");
    const names = await detectNameCandidatesAsync("ただとしのアカウントが不正利用された。");
    expect(names).toContain("ただとし");
  });
});

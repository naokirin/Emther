import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
}));

vi.mock("@/lib/local-model", () => ({
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

describe("theme-store", () => {
  it("候補を作成し採用・却下できる", async () => {
    const store = await import("@/lib/theme-store");
    const candidate = await store.createThemeCandidate({
      title: "承認待ちの構造化",
      summary: "複数チームで承認が滞っている",
      rationale: "JournalとIssueに同種の詰まりが繰り返されているため",
      facts: ["Aチームのリリース遅延", "Bチームの決裁待ち"],
    });
    expect(candidate.status).toBe("candidate");
    expect(store.listAdoptedThemes()).toHaveLength(0);

    const adopted = await store.adoptTheme(candidate.id);
    expect(adopted?.status).toBe("adopted");
    expect(store.listAdoptedThemes()).toHaveLength(1);

    const dismissed = store.dismissTheme(candidate.id);
    expect(dismissed?.status).toBe("dismissed");
    expect(store.listAdoptedThemes()).toHaveLength(0);
  });

  it("reviseはsupersedesで新版を作り旧版をdismissする", async () => {
    const store = await import("@/lib/theme-store");
    const candidate = await store.createThemeCandidate({
      title: "旧タイトル",
      summary: "旧見立て",
      rationale: "旧根拠",
      facts: ["f1"],
    });
    await store.adoptTheme(candidate.id);
    const revised = await store.reviseTheme(candidate.id, { title: "新タイトル", rationale: "訂正した根拠" });
    expect(revised?.supersedes).toBe(candidate.id);
    expect(store.getTheme(candidate.id)?.status).toBe("dismissed");
    expect(store.listCurrentThemes({ status: "adopted" })).toHaveLength(1);
  });
});

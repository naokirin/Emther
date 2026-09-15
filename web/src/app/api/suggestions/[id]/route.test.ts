import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/name-candidate-detect", () => ({
  detectNameCandidatesAsync: async () => [] as string[],
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
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

// docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。
describe("PATCH /api/suggestions/[id] archived", () => {
  it("archived:trueでアーカイブし、falseで解除できる", async () => {
    const suggestionStore = await import("@/lib/suggestion-store");
    const s = await suggestionStore.createSuggestion("重複した提案");
    const route = await import("./route");

    const archiveRes = await route.PATCH(
      new Request(`http://localhost/api/suggestions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      }),
      { params: Promise.resolve({ id: s.id }) },
    );
    expect(archiveRes.status).toBe(200);
    const archiveJson = await archiveRes.json();
    expect(archiveJson.suggestion.archivedAt).toBeTypeOf("number");
    expect(archiveJson.suggestion.reviewStatus).toBe("unreviewed");

    const unarchiveRes = await route.PATCH(
      new Request(`http://localhost/api/suggestions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      }),
      { params: Promise.resolve({ id: s.id }) },
    );
    expect(unarchiveRes.status).toBe(200);
    const unarchiveJson = await unarchiveRes.json();
    expect(unarchiveJson.suggestion.archivedAt).toBeUndefined();
  });

  it("archivedが真偽値でない場合は400", async () => {
    const suggestionStore = await import("@/lib/suggestion-store");
    const s = await suggestionStore.createSuggestion("テスト用の提案");
    const route = await import("./route");

    const res = await route.PATCH(
      new Request(`http://localhost/api/suggestions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: "yes" }),
      }),
      { params: Promise.resolve({ id: s.id }) },
    );
    expect(res.status).toBe(400);
  });
});

// ユーザー要望「後回しにする場合でも『いつまでには確認したい』という期日を入力したい」対応。
describe("PATCH /api/suggestions/[id] reviewDueAt", () => {
  it("reviewDueAtを設定・null で解除できる", async () => {
    const suggestionStore = await import("@/lib/suggestion-store");
    const s = await suggestionStore.createSuggestion("期日をつけたい提案");
    const route = await import("./route");

    const setRes = await route.PATCH(
      new Request(`http://localhost/api/suggestions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewDueAt: 123456 }),
      }),
      { params: Promise.resolve({ id: s.id }) },
    );
    expect(setRes.status).toBe(200);
    expect((await setRes.json()).suggestion.reviewDueAt).toBe(123456);

    const clearRes = await route.PATCH(
      new Request(`http://localhost/api/suggestions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewDueAt: null }),
      }),
      { params: Promise.resolve({ id: s.id }) },
    );
    expect(clearRes.status).toBe(200);
    expect((await clearRes.json()).suggestion.reviewDueAt).toBeUndefined();
  });

  it("reviewDueAtが数値でもnullでもない場合は400", async () => {
    const suggestionStore = await import("@/lib/suggestion-store");
    const s = await suggestionStore.createSuggestion("テスト用の提案");
    const route = await import("./route");

    const res = await route.PATCH(
      new Request(`http://localhost/api/suggestions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewDueAt: "2026-09-20" }),
      }),
      { params: Promise.resolve({ id: s.id }) },
    );
    expect(res.status).toBe(400);
  });
});

// ユーザー要望「確認状態に『確認中』ステータスを追加したい」対応。
describe("PATCH /api/suggestions/[id] reviewStatus=in_review", () => {
  it("確認中(in_review)へ変更できる", async () => {
    const suggestionStore = await import("@/lib/suggestion-store");
    const s = await suggestionStore.createSuggestion("検討中の提案");
    const route = await import("./route");

    const res = await route.PATCH(
      new Request(`http://localhost/api/suggestions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus: "in_review" }),
      }),
      { params: Promise.resolve({ id: s.id }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).suggestion.reviewStatus).toBe("in_review");
  });
});

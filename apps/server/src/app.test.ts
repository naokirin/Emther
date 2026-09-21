import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

// app.tsは全routes/*.tsをimportするため（settings-rules.ts/models-status.ts経由で
// model-loader.tsがEMBEDDING_MODEL等の定数を参照する）、他のテストファイルのような
// 関数だけの部分モックだと不足するexportでエラーになる。importOriginalで実物を
// ベースにしつつ、実際にモデルをロードする関数だけ差し替える。
vi.mock("@emther/core/local-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@emther/core/local-model")>();
  return {
    ...actual,
    runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
    extractFirstJsonObject: (text: string) => text,
  };
});

vi.mock("@emther/core/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@emther/core/embeddings")>();
  return {
    ...actual,
    embedText: vi.fn(async () => [1, 0, 0]),
    cosineSimilarity: () => 0,
  };
});

vi.mock("@emther/core/cloud-chat", () => ({
  runCloudChat: vi.fn(async () => {
    throw new Error("cloud unavailable in test");
  }),
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

// route.ts単位のテストは各routes/*.tsのHonoインスタンスを直接requestするため、
// app.ts側のapp.route()マウント順に起因する衝突（静的パスが親の:idワイルドカードに
// 飲まれる等）を検出できない。実際に2026-09-19にGET /api/journal/dumpsが
// /api/journal の GET /:id（journalRoute）に飲まれる不具合が3バッチ気づかれずに
// 残っていた（docs/2nd_architecture/plan.md フェーズ2.5 高リスク バッチ9参照）。
// このテストは合成済みの`app`（createApp()の実際の出力）に対してリクエストし、
// 「親prefixの:idワイルドカードを持つルートの配下に、別ファイルで切り出した
// 静的サブパスが存在する」組み合わせを横断的に確認する。新しいルートを追加した
// ときは、該当するprefixの組み合わせをここに追記すること。
describe("createApp() のマウント順（静的サブパス vs 親の:idワイルドカード）", () => {
  it("GET /api/journal/dumps は journalDumpsRoute のGET /に届く（journalRouteのGET /:idに飲まれない）", async () => {
    const { app } = await import("./app");
    const res = await app.request("/api/journal/dumps");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dumps: [] });
  });

  it("GET /api/journal/dumps/profiles は journalDumpsRoute に届く", async () => {
    const { app } = await import("./app");
    const res = await app.request("/api/journal/dumps/profiles");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profiles: [] });
  });

  it("GET /api/journal/:id（実在しないID）は journalRoute 自身の404を返す（サブパスに誤って飲まれない）", async () => {
    const { app } = await import("./app");
    const res = await app.request("/api/journal/not-a-real-id");
    expect(res.status).toBe(404);
  });

  it("GET /api/agents/inbox は agentsInboxRoute に届く（agentsRouteのGET /:idに飲まれない）", async () => {
    const { app } = await import("./app");
    const res = await app.request("/api/agents/inbox");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(0);
  });

  it("GET /api/journal は journalRoute のGET /に届く（一覧が返る）", async () => {
    const { app } = await import("./app");
    const res = await app.request("/api/journal");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });

  it("GET /api/org/goals は goalsRoute に届く（一覧が返る）", async () => {
    const { app } = await import("./app");
    const res = await app.request("/api/org/goals");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ goals: [] });
  });

  it("POST /api/dashboard/why-now は dashboardWhyNowRoute に届く", async () => {
    const { createApp } = await import("./app");
    const app = createApp();
    // why-now は cloud 呼び出しを含むため、空 actions なら即 heuristic で返る
    const res = await app.request("/api/dashboard/why-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actions: [] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], source: "heuristic", fallbackReason: "no_actions" });
  });

  it("POST /api/suggestions/link/suggest は suggestionsLinkSuggestRoute に届く（suggestionsRouteに飲まれない）", async () => {
    const { app } = await import("./app");
    const res = await app.request("/api/suggestions/link/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [], targetCount: 0, source: "heuristic", fallbackReason: "no_unlinked_suggestions" });
  });

  it("POST /api/themes/link/suggest-goal は themeGoalLinkSuggestRoute に届く（themesRouteに飲まれない）", async () => {
    const { app } = await import("./app");
    const res = await app.request("/api/themes/link/suggest-goal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [], targetCount: 0, source: "heuristic", fallbackReason: "no_unlinked_themes" });
  });
});

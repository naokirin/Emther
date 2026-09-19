import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { routeCtx } from "@core/test-helpers/api-route";

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@core/embeddings", () => ({
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

async function insertRun(suggestionUpdates: unknown) {
  const { getDb } = await import("@core/db");
  getDb()
    .prepare(
      `INSERT INTO agent_runs
        (id, agent_name, task, status, total_cost_usd, created_at, updated_at, origin, reviewed, suggested_suggestion_updates_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("run-1", "Lead Agent", "t", "idle", 0, 1, 1, "manual", 1, suggestionUpdates ? JSON.stringify(suggestionUpdates) : null);
}

// docs/suggestion_organize_via_consult.md「5. 反映の契約（HITL）」対応。
describe("POST /api/agents/[id]/suggestion-updates", () => {
  it("対象Suggestionへ変更を反映し、差分を消す", async () => {
    const suggestionStore = await import("@core/suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案");
    await insertRun([{ suggestionId: suggestion.id, reviewStatus: "done", reason: "対応済みのため" }]);
    const route = await import("./route");
    const res = await route.POST(new Request("http://localhost/x", { method: "POST" }), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.applied).toEqual([{ suggestionId: suggestion.id, reason: "対応済みのため" }]);
    expect(json.run.suggestedSuggestionUpdates).toBeUndefined();
    expect(suggestionStore.getSuggestion(suggestion.id)?.reviewStatus).toBe("done");
  });

  it("差分が無ければ400", async () => {
    await insertRun(undefined);
    const route = await import("./route");
    const res = await route.POST(new Request("http://localhost/x", { method: "POST" }), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(400);
  });

  it("runが無ければ404", async () => {
    const route = await import("./route");
    const res = await route.POST(new Request("http://localhost/x", { method: "POST" }), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("indicesを指定すると選んだ差分だけを反映し、残りは差分のまま残す", async () => {
    const suggestionStore = await import("@core/suggestion-store");
    const suggestionA = await suggestionStore.createSuggestion("対象提案A");
    const suggestionB = await suggestionStore.createSuggestion("対象提案B");
    await insertRun([
      { suggestionId: suggestionA.id, reviewStatus: "done", reason: "Aの理由" },
      { suggestionId: suggestionB.id, reviewStatus: "done", reason: "Bの理由" },
    ]);
    const route = await import("./route");
    const res = await route.POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indices: [0] }),
      }),
      routeCtx({ id: "run-1" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.applied).toEqual([{ suggestionId: suggestionA.id, reason: "Aの理由" }]);
    expect(json.run.suggestedSuggestionUpdates).toEqual([{ suggestionId: suggestionB.id, reviewStatus: "done", reason: "Bの理由" }]);
    expect(suggestionStore.getSuggestion(suggestionA.id)?.reviewStatus).toBe("done");
    expect(suggestionStore.getSuggestion(suggestionB.id)?.reviewStatus).toBe("unreviewed");
  });
});

describe("DELETE /api/agents/[id]/suggestion-updates", () => {
  it("差分を却下できる（Suggestion本体は変更しない）", async () => {
    const suggestionStore = await import("@core/suggestion-store");
    const suggestion = await suggestionStore.createSuggestion("対象提案");
    await insertRun([{ suggestionId: suggestion.id, reviewStatus: "done", reason: "対応済みのため" }]);
    const route = await import("./route");
    const res = await route.DELETE(new Request("http://localhost/x", { method: "DELETE" }), routeCtx({ id: "run-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).run.suggestedSuggestionUpdates).toBeUndefined();
    expect(suggestionStore.getSuggestion(suggestion.id)?.reviewStatus).toBe("unreviewed");
  });

  it("indicesを指定すると選んだ差分だけを却下し、残りは差分のまま残す", async () => {
    const suggestionStore = await import("@core/suggestion-store");
    const suggestionA = await suggestionStore.createSuggestion("対象提案A");
    const suggestionB = await suggestionStore.createSuggestion("対象提案B");
    await insertRun([
      { suggestionId: suggestionA.id, reviewStatus: "done", reason: "Aの理由" },
      { suggestionId: suggestionB.id, reviewStatus: "done", reason: "Bの理由" },
    ]);
    const route = await import("./route");
    const res = await route.DELETE(
      new Request("http://localhost/x", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indices: [0] }),
      }),
      routeCtx({ id: "run-1" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.run.suggestedSuggestionUpdates).toEqual([{ suggestionId: suggestionB.id, reviewStatus: "done", reason: "Bの理由" }]);
  });
});

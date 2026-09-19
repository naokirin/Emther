import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

function patch(body: unknown) {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("GET /api/growth/suggestions", () => {
  it("空なら空配列", async () => {
    const { growthSuggestionsRoute } = await import("./growth-suggestions");
    const res = await growthSuggestionsRoute.request("/");
    expect(await res.json()).toEqual({ suggestions: [] });
  });

  it("生成済みの提案を新しい順で返す", async () => {
    const growthStore = await import("@emther/core/em-growth-store");
    growthStore.createGrowSuggestions([{ title: "タイトル", rationale: "根拠", references: [] }]);
    const { growthSuggestionsRoute } = await import("./growth-suggestions");
    const res = await growthSuggestionsRoute.request("/");
    const json = await res.json();
    expect(json.suggestions).toHaveLength(1);
    expect(json.suggestions[0].title).toBe("タイトル");
    expect(json.suggestions[0].status).toBe("unread");
  });
});

describe("PATCH /api/growth/suggestions/:id", () => {
  it("statusが不正なら400", async () => {
    const { growthSuggestionsRoute } = await import("./growth-suggestions");
    const res = await growthSuggestionsRoute.request("/missing", patch({ status: "invalid" }));
    expect(res.status).toBe(400);
  });

  it("存在しないidなら404", async () => {
    const { growthSuggestionsRoute } = await import("./growth-suggestions");
    const res = await growthSuggestionsRoute.request("/missing", patch({ status: "acknowledged" }));
    expect(res.status).toBe(404);
  });

  it("statusを更新できる", async () => {
    const growthStore = await import("@emther/core/em-growth-store");
    const [created] = growthStore.createGrowSuggestions([{ title: "タイトル", rationale: "根拠", references: [] }]);
    const { growthSuggestionsRoute } = await import("./growth-suggestions");
    const res = await growthSuggestionsRoute.request(`/${created.id}`, patch({ status: "dismissed" }));
    expect(res.status).toBe(200);
    expect((await res.json()).suggestion.status).toBe("dismissed");
  });
});

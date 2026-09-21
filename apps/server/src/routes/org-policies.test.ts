import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

vi.mock("@emther/core/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@emther/core/embeddings", () => ({
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

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function patch(body: unknown) {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("GET /api/org/policies", () => {
  it("既定は空配列", async () => {
    const { orgPoliciesRoute } = await import("./org-policies");
    const res = await orgPoliciesRoute.request("/");
    expect(await res.json()).toEqual({ policies: [] });
  });
});

describe("POST /api/org/policies", () => {
  it("textは必須、categoryは任意", async () => {
    const { orgPoliciesRoute } = await import("./org-policies");
    const bad = await orgPoliciesRoute.request("/", post({ text: "" }));
    expect(bad.status).toBe(400);

    const res = await orgPoliciesRoute.request("/", post({ text: "小さく届けてフィードバックを得る", category: "principle" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.policy.text).toBe("小さく届けてフィードバックを得る");
    expect(json.policy.category).toBe("principle");
    expect(json.policy.archivedAt).toBeUndefined();
  });

  it("不正なcategoryは無視される", async () => {
    const { orgPoliciesRoute } = await import("./org-policies");
    const res = await orgPoliciesRoute.request("/", post({ text: "やらないことを決める", category: "bogus" }));
    const json = await res.json();
    expect(json.policy.category).toBeUndefined();
  });
});

describe("PATCH/DELETE /api/org/policies/:id", () => {
  it("更新・アーカイブ・削除ができる", async () => {
    const { orgPoliciesRoute } = await import("./org-policies");
    const created = await orgPoliciesRoute.request("/", post({ text: "現場の裁量を優先する", category: "priority" }));
    const { policy } = await created.json();

    const patched = await orgPoliciesRoute.request(`/${policy.id}`, patch({ text: "現場の裁量を最優先する" }));
    expect(patched.status).toBe(200);
    const patchedJson = await patched.json();
    expect(patchedJson.policy.text).toBe("現場の裁量を最優先する");

    const archived = await orgPoliciesRoute.request(`/${policy.id}`, patch({ archived: true }));
    const archivedJson = await archived.json();
    expect(archivedJson.policy.archivedAt).toBeDefined();

    const deleted = await orgPoliciesRoute.request(`/${policy.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const list = await (await orgPoliciesRoute.request("/")).json();
    expect(list.policies).toEqual([]);
  });

  it("存在しないidは404", async () => {
    const { orgPoliciesRoute } = await import("./org-policies");
    const res = await orgPoliciesRoute.request("/no-such-id", patch({ text: "x" }));
    expect(res.status).toBe(404);
  });
});

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

describe("GET /api/org/background", () => {
  it("既定は空配列", async () => {
    const { orgBackgroundRoute } = await import("./org-background");
    const res = await orgBackgroundRoute.request("/");
    expect(await res.json()).toEqual({ backgrounds: [] });
  });
});

describe("POST /api/org/background", () => {
  it("title/fact必須、既定scopeはalways", async () => {
    const { orgBackgroundRoute } = await import("./org-background");
    const bad = await orgBackgroundRoute.request("/", post({ title: "x" }));
    expect(bad.status).toBe(400);

    const res = await orgBackgroundRoute.request(
      "/",
      post({
        title: "2024 個人情報漏洩",
        fact: "顧客データの一部が外部に流出した",
        implication: "セキュリティ投資を軽視しない",
        tags: ["security", "trust"],
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.background.title).toBe("2024 個人情報漏洩");
    expect(json.background.scope).toBe("always");
    expect(json.background.status).toBe("active");
    expect(json.background.tags).toEqual(["security", "trust"]);
  });
});

describe("PATCH/DELETE /api/org/background/:id", () => {
  it("更新と削除ができる", async () => {
    const { orgBackgroundRoute } = await import("./org-background");
    const created = await orgBackgroundRoute.request(
      "/",
      post({
        title: "去年赤字",
        fact: "通期で最終赤字だった",
        scope: "tagged",
        tags: ["finance"],
      }),
    );
    const { background } = await created.json();

    const patched = await orgBackgroundRoute.request(
      `/${background.id}`,
      patch({ implication: "採用・投資はコスト感度が高い", scope: "always" }),
    );
    expect(patched.status).toBe(200);
    const json = await patched.json();
    expect(json.background.implication).toBe("採用・投資はコスト感度が高い");
    expect(json.background.scope).toBe("always");

    const deleted = await orgBackgroundRoute.request(`/${background.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const list = await (await orgBackgroundRoute.request("/")).json();
    expect(list.backgrounds).toEqual([]);
  });
});

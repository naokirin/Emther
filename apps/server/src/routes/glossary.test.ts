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

describe("/api/glossary", () => {
  it("GET / は空なら空配列を返す", async () => {
    const { glossaryRoute } = await import("./glossary");
    const res = await glossaryRoute.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });

  it("POST / でエントリを作成し、GET /:id で取得できる", async () => {
    const { glossaryRoute } = await import("./glossary");
    const created = await glossaryRoute.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term: "OKR", meaning: "目標と主要な結果" }),
    });
    expect(created.status).toBe(201);
    const { entry } = await created.json();
    expect(entry.term).toBe("OKR");

    const fetched = await glossaryRoute.request(`/${entry.id}`);
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).entry.id).toBe(entry.id);
  });

  it("POST / でterm/meaningが無ければ400", async () => {
    const { glossaryRoute } = await import("./glossary");
    const res = await glossaryRoute.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /:id で更新、DELETE /:id で削除できる", async () => {
    const { glossaryRoute } = await import("./glossary");
    const created = await glossaryRoute.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term: "KPT", meaning: "振り返り手法" }),
    });
    const { entry } = await created.json();

    const patched = await glossaryRoute.request(`/${entry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meaning: "Keep/Problem/Try" }),
    });
    expect((await patched.json()).entry.meaning).toBe("Keep/Problem/Try");

    const deleted = await glossaryRoute.request(`/${entry.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);

    const afterDelete = await glossaryRoute.request(`/${entry.id}`);
    expect(afterDelete.status).toBe(404);
  });

  it("存在しないidのPATCH/DELETEは404", async () => {
    const { glossaryRoute } = await import("./glossary");
    const patched = await glossaryRoute.request("/missing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meaning: "x" }),
    });
    expect(patched.status).toBe(404);

    const deleted = await glossaryRoute.request("/missing", { method: "DELETE" });
    expect(deleted.status).toBe(404);
  });
});

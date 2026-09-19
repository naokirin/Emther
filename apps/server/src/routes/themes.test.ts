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

describe("GET /api/themes", () => {
  it("既定は空配列", async () => {
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/");
    expect(await res.json()).toEqual({ themes: [] });
  });

  it("statusで絞り込める", async () => {
    const { themesRoute } = await import("./themes");
    await themesRoute.request("/", post({ title: "採用済み", summary: "要約", status: "adopted" }));
    await themesRoute.request("/", post({ title: "候補", summary: "要約", status: "candidate" }));
    const res = await themesRoute.request("/?status=candidate");
    const json = await res.json();
    expect(json.themes).toHaveLength(1);
    expect(json.themes[0].title).toBe("候補");
  });
});

describe("POST /api/themes", () => {
  it("title/summaryが無ければ400", async () => {
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/", post({ title: "x" }));
    expect(res.status).toBe(400);
  });

  it("作成できる（201、既定statusはadopted）", async () => {
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/", post({ title: "新テーマ", summary: "要約文" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.theme.title).toBe("新テーマ");
    expect(json.theme.status).toBe("adopted");
    expect(json.theme.rationale).toBe("要約文"); // rationale省略時はsummaryを使う
  });
});

describe("GET /api/themes/:id", () => {
  it("存在しないidは404", async () => {
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/missing");
    expect(res.status).toBe(404);
  });

  it("取得できる", async () => {
    const { themesRoute } = await import("./themes");
    const created = await themesRoute.request("/", post({ title: "テーマ", summary: "要約" }));
    const { theme } = await created.json();
    const res = await themesRoute.request(`/${theme.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).theme.id).toBe(theme.id);
  });
});

describe("PATCH /api/themes/:id", () => {
  it("action未指定・不正なら400", async () => {
    const { themesRoute } = await import("./themes");
    const created = await themesRoute.request("/", post({ title: "テーマ", summary: "要約" }));
    const { theme } = await created.json();
    const res = await themesRoute.request(`/${theme.id}`, patch({ action: "bogus" }));
    expect(res.status).toBe(400);
  });

  it("adopt/dismissできる", async () => {
    const { themesRoute } = await import("./themes");
    const created = await themesRoute.request("/", post({ title: "テーマ", summary: "要約", status: "candidate" }));
    const { theme } = await created.json();

    const adopted = await themesRoute.request(`/${theme.id}`, patch({ action: "adopt" }));
    expect((await adopted.json()).theme.status).toBe("adopted");

    const dismissed = await themesRoute.request(`/${theme.id}`, patch({ action: "dismiss" }));
    expect((await dismissed.json()).theme.status).toBe("dismissed");
  });

  it("reviseで内容を更新できる", async () => {
    const { themesRoute } = await import("./themes");
    const created = await themesRoute.request("/", post({ title: "テーマ", summary: "要約" }));
    const { theme } = await created.json();
    const res = await themesRoute.request(`/${theme.id}`, patch({ action: "revise", title: "改訂タイトル" }));
    expect((await res.json()).theme.title).toBe("改訂タイトル");
  });

  it("actionを省略しobjectiveIdsを渡すとlinkとして扱う", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const objective = await orgStore.addObjective("Objective");
    const { themesRoute } = await import("./themes");
    const created = await themesRoute.request("/", post({ title: "テーマ", summary: "要約" }));
    const { theme } = await created.json();
    const res = await themesRoute.request(`/${theme.id}`, patch({ objectiveIds: [objective.id] }));
    expect(res.status).toBe(200);
    expect((await res.json()).theme.objectiveIds).toEqual([objective.id]);
  });

  it("存在しないidは404", async () => {
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/missing", patch({ action: "adopt" }));
    expect(res.status).toBe(404);
  });
});

// docs/value_hierarchy_and_flow.md §2.3。
describe("POST /api/themes/from-okr", () => {
  it("Objectiveが無ければ400", async () => {
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/from-okr", post({}));
    expect(res.status).toBe(400);
  });

  it("Objective単位で候補テーマを作成する", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const objective = await orgStore.addObjective("売上を伸ばす");
    await orgStore.addKeyResult(objective.id, "新規契約10件");
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/from-okr", post({}));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.themes).toHaveLength(1);
    expect(json.themes[0].title).toBe("売上を伸ばす");
    expect(json.themes[0].status).toBe("candidate");
  });

  it("perKeyResultを指定するとKey Result単位で分割する", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const objective = await orgStore.addObjective("売上を伸ばす");
    await orgStore.addKeyResult(objective.id, "新規契約10件");
    await orgStore.addKeyResult(objective.id, "解約率を下げる");
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/from-okr", post({ perKeyResult: true }));
    const json = await res.json();
    expect(json.themes).toHaveLength(2);
  });

  it("objectiveIdsで対象を絞り込める", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const a = await orgStore.addObjective("A");
    await orgStore.addObjective("B");
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/from-okr", post({ objectiveIds: [a.id] }));
    const json = await res.json();
    expect(json.themes).toHaveLength(1);
    expect(json.themes[0].title).toBe("A");
  });
});

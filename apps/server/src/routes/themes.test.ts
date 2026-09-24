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
  it("titleが無ければ400", async () => {
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/", post({ summary: "x" }));
    expect(res.status).toBe(400);
  });

  it("summary省略でも作成できる（rationaleはtitleにフォールバック）", async () => {
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/", post({ title: "タイトルのみ" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.theme.title).toBe("タイトルのみ");
    expect(json.theme.rationale).toBe("タイトルのみ");
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

  // Decision 1
  it("goalIdsを渡すとlinkとして扱い、nullで解除できる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const goal = await orgStore.addGoal({ title: "信頼性を高める" });
    const { themesRoute } = await import("./themes");
    const created = await themesRoute.request("/", post({ title: "テーマ", summary: "要約" }));
    const { theme } = await created.json();

    const linked = await themesRoute.request(`/${theme.id}`, patch({ goalIds: [goal.id] }));
    expect(linked.status).toBe(200);
    expect((await linked.json()).theme.goalIds).toEqual([goal.id]);

    const unlinked = await themesRoute.request(`/${theme.id}`, patch({ action: "link", goalIds: null }));
    expect((await unlinked.json()).theme.goalIds).toEqual([]);
  });

  it("存在しないidは404", async () => {
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/missing", patch({ action: "adopt" }));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/themes/from-goal", () => {
  it("Goalが無ければ400", async () => {
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/from-goal", post({}));
    expect(res.status).toBe(400);
  });

  it("Goal単位で候補テーマを作成する", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const goal = await orgStore.addGoal({ title: "チームの自律性を高めたい" });
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/from-goal", post({}));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.themes).toHaveLength(1);
    expect(json.themes[0].title).toBe("チームの自律性を高めたい");
    expect(json.themes[0].status).toBe("candidate");
    expect(json.themes[0].goalIds).toEqual([goal.id]);
  });

  it("達成済み・断念済みGoalは対象外", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const goal = await orgStore.addGoal({ title: "もう終わったGoal" });
    await orgStore.updateGoal(goal.id, { status: "achieved" });
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/from-goal", post({}));
    expect(res.status).toBe(400);
  });

  it("goalIdsで対象を絞り込める", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const a = await orgStore.addGoal({ title: "A" });
    await orgStore.addGoal({ title: "B" });
    const { themesRoute } = await import("./themes");
    const res = await themesRoute.request("/from-goal", post({ goalIds: [a.id] }));
    const json = await res.json();
    expect(json.themes).toHaveLength(1);
    expect(json.themes[0].title).toBe("A");
  });
});

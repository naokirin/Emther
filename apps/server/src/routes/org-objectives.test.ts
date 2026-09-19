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

describe("GET /api/org/objectives", () => {
  it("進捗つきで一覧を返す", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const issueStore = await import("@emther/core/issue-store");
    const objective = await orgStore.addObjective("売上を伸ばす");
    const withKr = await orgStore.addKeyResult(objective.id, "新規契約10件");
    const krId = withKr!.keyResults[0].id;
    // docs/2nd_pivot_version.md Phase 6対応。進捗はKRへ紐づく!archivedのIssue件数（total）のみ。
    await issueStore.createIssue("契約A", undefined, undefined, undefined, undefined, krId);

    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/");
    const json = await res.json();
    expect(json.objectives[0].progress[0]).toEqual({ keyResultId: krId, total: 1 });
  });
});

describe("POST /api/org/objectives", () => {
  it("titleが無ければ400", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/", post({ title: "  " }));
    expect(res.status).toBe(400);
  });

  it("作成できる（201）", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/", post({ title: "新しいObjective" }));
    expect(res.status).toBe(201);
    expect((await res.json()).objective.title).toBe("新しいObjective");
  });

  // ユーザー要望「目標のカスケーディング構成」対応。
  it("teamIdを指定するとそのチームの目標として作成できる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const team = orgStore.addTeam("Team A", []);
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/", post({ title: "チーム目標", teamId: team.id }));
    expect((await res.json()).objective.teamId).toBe(team.id);
  });

  it("teamIdを省略すると組織全体の目標になる", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/", post({ title: "組織目標" }));
    expect((await res.json()).objective.teamId).toBeUndefined();
  });
});

describe("PATCH /api/org/objectives/:id", () => {
  it("title・teamId・noteどれも無ければ400", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/missing", patch({}));
    expect(res.status).toBe(400);
  });

  it("存在しないIDは404", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/missing", patch({ title: "新タイトル" }));
    expect(res.status).toBe(404);
  });

  it("改名できる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const objective = await orgStore.addObjective("旧タイトル");
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request(`/${objective.id}`, patch({ title: "新タイトル" }));
    expect((await res.json()).objective.title).toBe("新タイトル");
  });

  it("noteだけを更新できる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const objective = await orgStore.addObjective("目標");
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request(`/${objective.id}`, patch({ note: "判断理由" }));
    expect((await res.json()).objective.note).toBe("判断理由");
  });

  // ユーザー要望「目標のカスケーディング構成」対応。
  it("teamIdだけを指定して所属チームを設定できる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const team = orgStore.addTeam("Team A", []);
    const objective = await orgStore.addObjective("組織目標");
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request(`/${objective.id}`, patch({ teamId: team.id }));
    expect((await res.json()).objective.teamId).toBe(team.id);
  });

  it("teamId:nullで組織全体の目標に戻せる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const team = orgStore.addTeam("Team A", []);
    const objective = await orgStore.addObjective("チーム目標", team.id);
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request(`/${objective.id}`, patch({ teamId: null }));
    expect((await res.json()).objective.teamId).toBeUndefined();
  });
});

describe("DELETE /api/org/objectives/:id", () => {
  it("存在しないIDは404", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("削除できる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const objective = await orgStore.addObjective("消すObjective");
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request(`/${objective.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(orgStore.getObjective(objective.id)).toBeUndefined();
  });
});

describe("POST /api/org/objectives/:id/key-results", () => {
  it("titleが無ければ400", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/missing/key-results", post({}));
    expect(res.status).toBe(400);
  });

  it("存在しないObjectiveは404", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/missing/key-results", post({ title: "KR" }));
    expect(res.status).toBe(404);
  });

  it("追加できる（201）", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const objective = await orgStore.addObjective("Objective");
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request(`/${objective.id}/key-results`, post({ title: "新規契約10件" }));
    expect(res.status).toBe(201);
    expect((await res.json()).objective.keyResults[0].title).toBe("新規契約10件");
  });
});

describe("PATCH /api/org/objectives/:id/key-results/:krId", () => {
  it("titleが無ければ400", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/missing/key-results/missing", patch({}));
    expect(res.status).toBe(400);
  });

  it("存在しないObjectiveは404", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/missing/key-results/missing", patch({ title: "新KR" }));
    expect(res.status).toBe(404);
  });

  it("タイトルを更新できる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const objective = await orgStore.addObjective("Objective");
    const withKr = await orgStore.addKeyResult(objective.id, "旧KR");
    const krId = withKr!.keyResults[0].id;
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request(`/${objective.id}/key-results/${krId}`, patch({ title: "新KR" }));
    expect(res.status).toBe(200);
    expect((await res.json()).objective.keyResults[0].title).toBe("新KR");
  });
});

describe("DELETE /api/org/objectives/:id/key-results/:krId", () => {
  it("存在しないObjectiveは404", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request("/missing/key-results/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("削除できる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const objective = await orgStore.addObjective("Objective");
    const withKr = await orgStore.addKeyResult(objective.id, "KR");
    const krId = withKr!.keyResults[0].id;
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request(`/${objective.id}/key-results/${krId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await res.json()).objective.keyResults).toHaveLength(0);
  });
});

describe("POST /api/org/objectives/import", () => {
  it("mode不正は400", async () => {
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request(
      "/import",
      post({ mode: "merge", objectives: [{ title: "x", keyResults: [] }] }),
    );
    expect(res.status).toBe(400);
  });

  it("追記できる", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    await orgStore.addObjective("既存");
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request(
      "/import",
      post({ mode: "append", objectives: [{ title: "新規", note: "理由", keyResults: ["KR1"] }] }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.objectives).toHaveLength(1);
    expect(data.objectives[0].title).toBe("新規");
    expect(data.objectives[0].note).toBe("理由");
    expect(orgStore.listObjectives()).toHaveLength(2);
  });

  it("差し替えは同一スコープのみ消す", async () => {
    const orgStore = await import("@emther/core/org-context-store/index");
    const team = orgStore.addTeam("Team A", []);
    await orgStore.addObjective("組織");
    await orgStore.addObjective("チーム旧", team.id);
    const { orgObjectivesRoute } = await import("./org-objectives");
    const res = await orgObjectivesRoute.request(
      "/import",
      post({ mode: "replace", teamId: team.id, objectives: [{ title: "チーム新", keyResults: [] }] }),
    );
    expect(res.status).toBe(201);
    const titles = orgStore.listObjectives().map((o) => o.title);
    expect(titles).toContain("組織");
    expect(titles).toContain("チーム新");
    expect(titles).not.toContain("チーム旧");
  });
});

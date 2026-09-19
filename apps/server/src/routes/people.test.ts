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

describe("GET /api/people", () => {
  it("登録済みの人物サマリーを返す", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    peopleDirectory.registerName("Aさん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request("/");
    const json = await res.json();
    expect(json.people).toHaveLength(1);
    expect(json.people[0].name).toBe("Aさん");
  });
});

describe("POST /api/people", () => {
  it("人物を直接登録できる", async () => {
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request("/", post({ name: "田中さん" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.person.name).toBe("田中さん");
    expect(json.person.id).toBe("PERSON_1");
  });

  it("空の名前は400", async () => {
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request("/", post({ name: "  " }));
    expect(res.status).toBe(400);
  });

  it("敬称違いの既存人物には同じIDを返す", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    peopleDirectory.registerName("田中さん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request("/", post({ name: "田中くん" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.person.id).toBe("PERSON_1");
  });

  it("aliases を同時に登録できる", async () => {
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request("/", post({ name: "山田さん", aliases: ["山田くん", "Yamada"] }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.person.name).toBe("山田さん");
    expect(json.person.aliases).toEqual(expect.arrayContaining(["山田くん", "Yamada"]));
  });
});

describe("GET /api/people/:id", () => {
  it("存在しないIDは404", async () => {
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request("/missing");
    expect(res.status).toBe(404);
  });

  it("プロファイルを返す", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const id = peopleDirectory.registerName("Aさん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).person.name).toBe("Aさん");
  });
});

// ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。
describe("PATCH /api/people/:id", () => {
  it("addAliasで別名を追加できる", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const id = peopleDirectory.registerName("田中さん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${id}`, patch({ addAlias: "田中" }));
    expect(res.status).toBe(200);
    expect((await res.json()).person.aliases).toEqual(["田中"]);
  });

  it("removeAliasで別名を取り消せる", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const id = peopleDirectory.registerName("田中さん");
    peopleDirectory.addAlias(id, "田中");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${id}`, patch({ removeAlias: "田中" }));
    expect(res.status).toBe(200);
    expect((await res.json()).person.aliases).toEqual([]);
  });

  it("addAlias/removeAlias/nameどれも無ければ400", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const id = peopleDirectory.registerName("田中さん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${id}`, patch({}));
    expect(res.status).toBe(400);
  });

  it("nameで正式名を変更できる", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const id = peopleDirectory.registerName("田中さん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${id}`, patch({ name: "田中" }));
    expect(res.status).toBe(200);
    expect((await res.json()).person.name).toBe("田中");
    expect(peopleDirectory.listPeople()[0].aliases).toContain("田中さん");
  });

  it("addAliasが既に別の人物のものなら400", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const id = peopleDirectory.registerName("田中さん");
    peopleDirectory.registerName("佐藤さん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${id}`, patch({ addAlias: "佐藤さん" }));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/people/:id", () => {
  it("存在しないIDは404", async () => {
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request("/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("誤登録エントリを削除できる", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const id = peopleDirectory.registerName("誤登録");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(peopleDirectory.listPeople()).toHaveLength(0);
  });
});

// ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
describe("POST /api/people/:id/merge", () => {
  it("duplicateIdをURLの:idへ統合し、統合後のプロファイルを返す", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const fromId = peopleDirectory.registerName("たなかさん");
    const toId = peopleDirectory.registerName("田中さん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${toId}/merge`, post({ duplicateId: fromId }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.person.id).toBe(toId);
    expect(json.person.aliases).toEqual(["たなかさん"]);
    expect(peopleDirectory.listPeople()).toHaveLength(1);
  });

  it("duplicateIdが無ければ400", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const toId = peopleDirectory.registerName("田中さん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${toId}/merge`, post({}));
    expect(res.status).toBe(400);
  });

  it("存在しないduplicateIdは400", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const toId = peopleDirectory.registerName("田中さん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${toId}/merge`, post({ duplicateId: "PERSON_999" }));
    expect(res.status).toBe(400);
  });
});

// ユーザー指摘「メンバーのアラート表示を確認したが対応不要だったことを示せない」対応。
describe("PATCH /api/people/:id/concern-acks/:issueId", () => {
  it("存在しない人物は404", async () => {
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request("/missing/concern-acks/issue-1", patch({ acknowledged: true }));
    expect(res.status).toBe(404);
  });

  it("acknowledgedが未指定は400", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const id = peopleDirectory.registerName("Aさん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${id}/concern-acks/issue-1`, patch({}));
    expect(res.status).toBe(400);
  });

  it("acknowledged: trueで確認済みを記録し、people-hubのhasConcerningIssueから除外される", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const issueStore = await import("@emther/core/issue-store");
    const hub = await import("@emther/core/people-hub");
    const id = peopleDirectory.registerName("Aさん");
    const issue = await issueStore.createIssue("Aさんの育成計画");
    issueStore.setIssueStatus(issue.id, "blocked");
    expect(hub.getPersonProfile(id)?.hasConcerningIssue).toBe(true);

    const { peopleRoute } = await import("./people");
    const ackRes = await peopleRoute.request(`/${id}/concern-acks/${issue.id}`, patch({ acknowledged: true, note: "対応不要" }));
    expect(ackRes.status).toBe(200);
    expect(hub.getPersonProfile(id)?.hasConcerningIssue).toBe(false);

    const clearRes = await peopleRoute.request(`/${id}/concern-acks/${issue.id}`, patch({ acknowledged: false }));
    expect(clearRes.status).toBe(200);
    expect(hub.getPersonProfile(id)?.hasConcerningIssue).toBe(true);
  });
});

describe("GET/POST /api/people/:id/evaluation-logs", () => {
  it("存在しない人物は404", async () => {
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request("/missing/evaluation-logs");
    expect(res.status).toBe(404);
  });

  it("登録済みログを一覧できる", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const store = await import("@emther/core/person-evaluation-store");
    const id = peopleDirectory.registerName("Aさん");
    await store.createEvaluationLog({
      personId: id,
      lens: "outcome",
      sourceJournalId: "j1",
      snapshotText: "成果",
      rationale: "r",
    });
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${id}/evaluation-logs`);
    expect(res.status).toBe(200);
    expect((await res.json()).logs).toHaveLength(1);
  });

  it("suggest-from-journal以外のactionは400", async () => {
    const peopleDirectory = await import("@emther/core/people-directory");
    const id = peopleDirectory.registerName("Aさん");
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/${id}/evaluation-logs`, post({ action: "invalid" }));
    expect(res.status).toBe(400);
  });
});

// ユーザー指摘「懸念を確認したが対応不要だった、を示せず強調を減らせない」対応。
describe("PATCH /api/people/:id/evaluation-logs/:logId", () => {
  it("存在しないlogIdは404", async () => {
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request("/PERSON_1/evaluation-logs/missing", patch({ status: "confirmed" }));
    expect(res.status).toBe(404);
  });

  it("statusもnoActionNeededも無い場合は400", async () => {
    const store = await import("@emther/core/person-evaluation-store");
    const log = await store.createEvaluationLog({
      personId: "PERSON_1",
      lens: "outcome",
      sourceJournalId: "j1",
      snapshotText: "成果",
      rationale: "r",
    });
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/PERSON_1/evaluation-logs/${log.id}`, patch({}));
    expect(res.status).toBe(400);
  });

  it("noActionNeeded: trueで懸念の確認済みを記録し、falseで取り消せる", async () => {
    const store = await import("@emther/core/person-evaluation-store");
    const log = await store.createEvaluationLog({
      personId: "PERSON_1",
      lens: "outcome",
      polarity: "concern",
      sourceJournalId: "j1",
      snapshotText: "懸念",
      rationale: "r",
    });
    const { peopleRoute } = await import("./people");

    const ackRes = await peopleRoute.request(
      `/PERSON_1/evaluation-logs/${log.id}`,
      patch({ noActionNeeded: true, noActionNeededNote: "対応不要" }),
    );
    expect(ackRes.status).toBe(200);
    const acked = (await ackRes.json()).log;
    expect(acked.polarity).toBe("concern");
    expect(acked.noActionNeededAt).toBeDefined();
    expect(acked.noActionNeededNote).toBe("対応不要");
    expect(acked.status).toBe("provisional"); // statusは変わらない

    const clearRes = await peopleRoute.request(`/PERSON_1/evaluation-logs/${log.id}`, patch({ noActionNeeded: false }));
    const cleared = (await clearRes.json()).log;
    expect(cleared.noActionNeededAt).toBeUndefined();
  });

  it("statusとnoActionNeededを同時に指定できる", async () => {
    const store = await import("@emther/core/person-evaluation-store");
    const log = await store.createEvaluationLog({
      personId: "PERSON_1",
      lens: "outcome",
      polarity: "concern",
      sourceJournalId: "j1",
      snapshotText: "懸念",
      rationale: "r",
    });
    const { peopleRoute } = await import("./people");
    const res = await peopleRoute.request(`/PERSON_1/evaluation-logs/${log.id}`, patch({ status: "confirmed", noActionNeeded: true }));
    const updated = (await res.json()).log;
    expect(updated.status).toBe("confirmed");
    expect(updated.noActionNeededAt).toBeDefined();
  });
});

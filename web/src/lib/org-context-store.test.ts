import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModule() {
  return import("@/lib/org-context-store");
}

describe("teams", () => {
  it("addTeamはチーム名を正規化し、メンバーをPERSON_n IDでマスクする", async () => {
    const store = await loadModule();
    const team = store.addTeam("Engineering / Team A", ["Aさん", "Bさん"]);
    expect(team.name).toBe("Engineering/Team A");
    expect(team.members).toEqual(["PERSON_1", "PERSON_2"]);
    expect(team.archived).toBe(false);
    // ユーザー要望「部下(自分が管理するチームのメンバー)とそれ以外を分けたい」対応。
    // 既定は「自分が管理するチーム」（既存の挙動を変えない既定値）。
    expect(team.managedByEm).toBe(true);
  });

  it("既存データ(managedByEmフィールド無し)は「自分が管理するチーム」として読み込む", async () => {
    const dataDir = join(dir, "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "teams.json"),
      JSON.stringify([
        { id: "legacy-1", name: "既存チーム", members: [], charter: { mission: "", constraints: "" }, archived: false, createdAt: 1, updatedAt: 1 },
      ]),
      "utf8",
    );
    const store = await loadModule();
    expect(store.getTeam("legacy-1")?.managedByEm).toBe(true);
  });

  it("updateTeamはmanagedByEmを更新できる", async () => {
    const store = await loadModule();
    const team = store.addTeam("パートナーチーム", []);
    const updated = await store.updateTeam(team.id, { managedByEm: false });
    expect(updated?.managedByEm).toBe(false);
    // 変化が無ければupdatedAtも動かさない（他フィールドと同じ規約）。
    const same = await store.updateTeam(team.id, { managedByEm: false });
    expect(same?.updatedAt).toBe(updated?.updatedAt);
  });

  // ユーザー要望「チーム名についても表記揺れ対応できると嬉しい」対応。
  it("addTeamはaliases:[]で作成し、updateTeamで別名を設定・重複排除・空文字除去できる", async () => {
    const store = await loadModule();
    const team = store.addTeam("Team A", []);
    expect(team.aliases).toEqual([]);

    const updated = await store.updateTeam(team.id, { aliases: ["エンジニアリングチーム", "  ", "エンジニアリングチーム"] });
    expect(updated?.aliases).toEqual(["エンジニアリングチーム"]);
  });

  it("toTeamViewはmembersを実名へ復元する", async () => {
    const store = await loadModule();
    const team = store.addTeam("Team A", ["Aさん"]);
    const view = store.toTeamView(team);
    expect(view.members).toEqual(["Aさん"]);
  });

  it("listActiveTeamsはアーカイブ済みチームを除外する", async () => {
    const store = await loadModule();
    const t1 = store.addTeam("Team A", []);
    const t2 = store.addTeam("Team B", []);
    store.setTeamArchived(t2.id, true);
    expect(store.listTeams()).toHaveLength(2);
    expect(store.listActiveTeams().map((t) => t.id)).toEqual([t1.id]);
  });

  it("updateTeamは変更のあったフィールドだけ更新し、無変化なら何もしない", async () => {
    const store = await loadModule();
    const team = store.addTeam("Team A", ["Aさん"]);
    const same = await store.updateTeam(team.id, { name: "Team A" });
    expect(same?.updatedAt).toBe(team.updatedAt);

    const renamed = await store.updateTeam(team.id, { name: "Team A Renamed" });
    expect(renamed?.name).toBe("Team A Renamed");
    expect(renamed!.updatedAt).toBeGreaterThanOrEqual(team.updatedAt);
  });

  it("updateTeamは存在しないIDに対してundefinedを返す", async () => {
    const store = await loadModule();
    expect(await store.updateTeam("missing", { name: "x" })).toBeUndefined();
  });

  it("removeTeamは削除に成功した場合trueを返す", async () => {
    const store = await loadModule();
    const team = store.addTeam("Team A", []);
    expect(store.removeTeam(team.id)).toBe(true);
    expect(store.getTeam(team.id)).toBeUndefined();
    expect(store.removeTeam(team.id)).toBe(false);
  });

  // ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
  it("reassignPersonIdInTeamsはfromIdをtoIdへ置き換える", async () => {
    const store = await loadModule();
    const team = store.addTeam("Team A", ["Aさん"]); // PERSON_1
    store.reassignPersonIdInTeams("PERSON_1", "PERSON_2");
    expect(store.getTeam(team.id)?.members).toEqual(["PERSON_2"]);
  });

  it("統合先が既にメンバーなら、統合元は重複させず取り除くだけにする", async () => {
    const store = await loadModule();
    const team = store.addTeam("Team A", ["Aさん", "Bさん"]); // PERSON_1, PERSON_2
    store.reassignPersonIdInTeams("PERSON_1", "PERSON_2");
    expect(store.getTeam(team.id)?.members).toEqual(["PERSON_2"]);
  });

  it("対象を含まないチームには影響しない", async () => {
    const store = await loadModule();
    const team = store.addTeam("Team A", ["Aさん"]);
    const before = store.getTeam(team.id)!.updatedAt;
    store.reassignPersonIdInTeams("PERSON_999", "PERSON_2");
    expect(store.getTeam(team.id)?.members).toEqual(["PERSON_1"]);
    expect(store.getTeam(team.id)?.updatedAt).toBe(before);
  });
});

describe("org strategy", () => {
  it("既定値は空文字列", async () => {
    const store = await loadModule();
    expect(store.getOrgStrategy()).toEqual({ mission: "", vision: "", values: "" });
  });

  it("updateOrgStrategyは指定フィールドだけ更新する", async () => {
    const store = await loadModule();
    await store.updateOrgStrategy({ mission: "顧客に価値を届ける" });
    const strategy = store.getOrgStrategy();
    expect(strategy.mission).toBe("顧客に価値を届ける");
    expect(strategy.vision).toBe("");
  });
});

describe("objectives", () => {
  it("Objectiveの作成・改名・削除ができる", async () => {
    const store = await loadModule();
    const objective = await store.addObjective("売上を伸ばす");
    expect(store.listObjectives()).toHaveLength(1);

    const renamed = await store.updateObjective(objective.id, { title: "売上を2倍にする" });
    expect(renamed?.title).toBe("売上を2倍にする");

    expect(store.removeObjective(objective.id)).toBe(true);
    expect(store.listObjectives()).toHaveLength(0);
  });

  // ユーザー要望「目標のカスケーディング構成」対応。
  it("addObjectiveはteamIdを受け付け、updateObjectiveでteamIdを設定・解除できる", async () => {
    const store = await loadModule();
    const team = store.addTeam("Team A", []);
    const orgWide = await store.addObjective("組織目標");
    expect(orgWide.teamId).toBeUndefined();

    const teamObjective = await store.addObjective("チーム目標", team.id);
    expect(teamObjective.teamId).toBe(team.id);

    const cleared = await store.updateObjective(teamObjective.id, { teamId: null });
    expect(cleared?.teamId).toBeUndefined();

    const reassigned = await store.updateObjective(orgWide.id, { teamId: team.id });
    expect(reassigned?.teamId).toBe(team.id);
  });

  it("updateObjectiveは変更が無ければupdatedAtを動かさない", async () => {
    const store = await loadModule();
    const objective = await store.addObjective("売上を伸ばす");
    const same = await store.updateObjective(objective.id, { title: "売上を伸ばす" });
    expect(same?.updatedAt).toBe(objective.updatedAt);
  });

  it("updateObjectiveは存在しないIDに対してundefinedを返す", async () => {
    const store = await loadModule();
    expect(await store.updateObjective("missing", { title: "x" })).toBeUndefined();
  });

  it("KeyResultの追加・削除ができる", async () => {
    const store = await loadModule();
    const objective = await store.addObjective("売上を伸ばす");
    const withKr = await store.addKeyResult(objective.id, "新規契約を10件獲得する");
    expect(withKr?.keyResults).toHaveLength(1);

    const krId = withKr!.keyResults[0].id;
    const removed = store.removeKeyResult(objective.id, krId);
    expect(removed?.keyResults).toHaveLength(0);
  });

  it("updateKeyResultでタイトルを編集できる", async () => {
    const store = await loadModule();
    const objective = await store.addObjective("売上を伸ばす");
    const withKr = await store.addKeyResult(objective.id, "旧KR");
    const krId = withKr!.keyResults[0].id;
    const updated = await store.updateKeyResult(objective.id, krId, "新KR");
    expect(updated?.keyResults[0].title).toBe("新KR");
  });

  it("addObjectiveとupdateObjectiveでメモを扱える", async () => {
    const store = await loadModule();
    const objective = await store.addObjective("売上を伸ばす", undefined, "判断理由A");
    expect(objective.note).toBe("判断理由A");

    const cleared = await store.updateObjective(objective.id, { note: "" });
    expect(cleared?.note).toBeUndefined();

    const setAgain = await store.updateObjective(objective.id, { note: "判断理由B" });
    expect(setAgain?.note).toBe("判断理由B");
  });

  it("importObjectivesは追記と同一スコープ差し替えができる", async () => {
    const store = await loadModule();
    const team = store.addTeam("Team A", []);
    await store.addObjective("残すべき組織目標");
    await store.addObjective("消えるチーム目標", team.id);

    await store.importObjectives(
      [{ title: "新チーム目標", note: "理由", keyResults: ["KR1"] }],
      { mode: "replace", teamId: team.id },
    );

    const all = store.listObjectives();
    expect(all.find((o) => o.title === "残すべき組織目標")).toBeTruthy();
    expect(all.find((o) => o.title === "消えるチーム目標")).toBeUndefined();
    const created = all.find((o) => o.title === "新チーム目標");
    expect(created?.teamId).toBe(team.id);
    expect(created?.note).toBe("理由");
    expect(created?.keyResults.map((k: { title: string }) => k.title)).toEqual(["KR1"]);

    await store.importObjectives([{ title: "追記目標", keyResults: [] }], { mode: "append", teamId: team.id });
    expect(store.listObjectives().filter((o: { teamId?: string }) => o.teamId === team.id)).toHaveLength(2);
  });

  it("listObjectivesWithProgressはKeyResultに紐づくIssueのdone数（!archived）から進捗を計算する", async () => {
    const orgStore = await loadModule();
    const issueStore = await import("@/lib/issue-store");

    const objective = await orgStore.addObjective("売上を伸ばす");
    const withKr = await orgStore.addKeyResult(objective.id, "新規契約10件");
    const krId = withKr!.keyResults[0].id;

    const issue1 = await issueStore.createIssue("契約A", undefined, undefined, undefined, undefined, krId);
    await issueStore.createIssue("契約B", undefined, undefined, undefined, undefined, krId);
    issueStore.setIssueStatus(issue1.id, "done");

    const progress = orgStore.listObjectivesWithProgress();
    expect(progress[0].progress[0]).toEqual({ keyResultId: krId, total: 2, done: 1 });
  });

  it("listObjectivesWithProgressはarchivedなIssueを分母からも除外する", async () => {
    const orgStore = await loadModule();
    const issueStore = await import("@/lib/issue-store");

    const objective = await orgStore.addObjective("売上を伸ばす");
    const withKr = await orgStore.addKeyResult(objective.id, "新規契約10件");
    const krId = withKr!.keyResults[0].id;

    const issue1 = await issueStore.createIssue("契約A", undefined, undefined, undefined, undefined, krId);
    await issueStore.createIssue("契約B", undefined, undefined, undefined, undefined, krId);
    issueStore.setIssueArchived(issue1.id, true);

    const progress = orgStore.listObjectivesWithProgress();
    expect(progress[0].progress[0]).toEqual({ keyResultId: krId, total: 1, done: 0 });
  });

  it("toObjectiveViewはPERSON_n IDでマスクされたtitleを実名復元する", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const store = await loadModule();
    peopleDirectory.registerName("Aさん");
    const objective = await store.addObjective("Aさんの育成計画");
    expect(objective.title).not.toBe("Aさんの育成計画");
    const view = store.toObjectiveView(objective);
    expect(view.title).toBe("Aさんの育成計画");
  });

  it("toObjectiveViewはメモも実名復元する", async () => {
    const peopleDirectory = await import("@/lib/people-directory");
    const store = await loadModule();
    peopleDirectory.registerName("Aさん");
    const objective = await store.addObjective("育成", undefined, "Aさん向け");
    expect(objective.note).not.toBe("Aさん向け");
    expect(store.toObjectiveView(objective).note).toBe("Aさん向け");
  });
});

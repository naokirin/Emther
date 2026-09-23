import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "./test-helpers/store-env";

vi.mock("./local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("./embeddings", () => ({
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

async function loadModule() {
  return import("./org-context-store/index");
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

  it("valueItemsと補足を第一級として保存する", async () => {
    const store = await loadModule();
    await store.updateOrgStrategy({
      mission: "自律的に価値を届ける",
      missionElaboration: "委譲を指す",
      valueItems: [
        { statement: "事実に基づく判断", elaboration: "観測を先に置く" },
        { statement: "心理的安全性" },
      ],
    });
    const strategy = store.getOrgStrategy();
    expect(strategy.missionElaboration).toBe("委譲を指す");
    expect(strategy.valueItems).toEqual([
      { statement: "事実に基づく判断", elaboration: "観測を先に置く" },
      { statement: "心理的安全性" },
    ]);
    expect(strategy.values).toBe("事実に基づく判断\n心理的安全性");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "./test-helpers/store-env";

let mockExtraction: {
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
};

vi.mock("./local-model", () => ({
  runLocalChat: vi.fn(async (messages: { role: string; content: string }[]) => {
    const systemContent = messages[0]?.content ?? "";
    if (systemContent.includes("人物名だけ")) return JSON.stringify({ people: [] });
    return JSON.stringify(mockExtraction);
  }),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("./embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

// docs/memo.md「テキストから検出されたメンバー名を確実に『人物』にすべて登録する」対応で
// createJournalEventFromTextがdetectUnregisteredNameCandidatesを呼ぶようになったため、
// 実際の辞書・形態素解析（重い・並列実行時にタイムアウトしやすい）を避けてモックする。
vi.mock("./name-candidate-detect", () => ({
  detectNameCandidatesAsync: async () => [] as string[],
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
}));

vi.mock("./agent-runtime/index", () => ({
  startRun: vi.fn(async () => ({})),
  listRuns: () => [],
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  mockExtraction = { summary: "", tags: [], people: [], urgency: "mid", sentiment: "neutral",  };
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

async function loadModules() {
  const vitals = await import("./vitals");
  const orgStore = await import("./org-context-store/index");
  const journalStore = await import("./journal-store");
  const suggestionStore = await import("./suggestion-store");
  return { vitals, orgStore, journalStore, suggestionStore };
}

describe("computeOrgVitals", () => {
  it("メンバー未登録のチームは評価不能(unknown)", async () => {
    const { vitals, orgStore } = await loadModules();
    orgStore.addTeam("Team A", []);
    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("unknown");
    expect(result.teams[0].label).toBe("評価不能");
  });

  it("直近ウィンドウの件数がminEntriesForJudgement未満なら評価不能", async () => {
    const { vitals, orgStore } = await loadModules();
    orgStore.addTeam("Team A", ["Aさん"]);
    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("unknown");
  });

  it("ネガティブなJournalが多いチームはbad(要注意)判定になる", async () => {
    const { vitals, orgStore, journalStore } = await loadModules();
    orgStore.addTeam("Team A", ["Aさん"]);
    mockExtraction = { summary: "", tags: [], people: ["Aさん"], urgency: "mid", sentiment: "negative",  };
    await journalStore.addJournalEntry("Aさんが不満");
    await journalStore.addJournalEntry("Aさんがまた不満");

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("bad");
    expect(result.teams[0].label).toBe("要注意");
  });

  it("ポジティブなJournalが多いチームはgood(安定)判定になる", async () => {
    const { vitals, orgStore, journalStore } = await loadModules();
    orgStore.addTeam("Team A", ["Aさん"]);
    mockExtraction = { summary: "", tags: [], people: ["Aさん"], urgency: "mid", sentiment: "positive",  };
    await journalStore.addJournalEntry("Aさんが好調");
    await journalStore.addJournalEntry("Aさんがまた好調");

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("good");
  });

  it("チーム・メンバーが登録されていなければ1on1カバレッジは評価不能", async () => {
    const { vitals } = await loadModules();
    const result = vitals.computeOrgVitals();
    expect(result.oneOnOneCoverage.status).toBe("unknown");
  });

  it("1on1タグ付きJournalで言及されたメンバーだけがカバレッジ対象になる", async () => {
    const { vitals, orgStore, journalStore } = await loadModules();
    orgStore.addTeam("Team A", ["Aさん", "Bさん"]);
    mockExtraction = { summary: "", tags: ["1on1"], people: ["Aさん"], urgency: "mid", sentiment: "neutral",  };
    await journalStore.addJournalEntry("Aさんと1on1した");

    const result = vitals.computeOrgVitals();
    expect(result.oneOnOneCoverage.covered).toBe(1);
    expect(result.oneOnOneCoverage.total).toBe(2);
    expect(result.oneOnOneCoverage.uncoveredMembers).toEqual(["PERSON_2"]);
  });

  // ユーザー要望「部下(自分が管理するチームのメンバー)とそれ以外を分けたい」対応。
  it("自分が管理していないチーム(managedByEm:false)のメンバーは1on1カバレッジの対象外", async () => {
    const { vitals, orgStore } = await loadModules();
    const team = orgStore.addTeam("パートナーチーム", ["Cさん"]);
    await orgStore.updateTeam(team.id, { managedByEm: false });

    const result = vitals.computeOrgVitals();
    expect(result.oneOnOneCoverage.status).toBe("unknown");
    expect(result.oneOnOneCoverage.total).toBe(0);
  });

  // ユーザー要望「メンバーに自分自身を追加したいが区別できない」対応。
  it("利用者本人(selfPersonId)は1on1カバレッジとTeamVital.membersから除外する", async () => {
    const { vitals, orgStore } = await loadModules();
    const peopleDirectory = await import("./people-directory");
    const settings = await import("./settings-store");
    const selfId = peopleDirectory.registerName("EM本人");
    const otherId = peopleDirectory.registerName("Aさん");
    orgStore.addTeam("Team A", ["EM本人", "Aさん"]);
    settings.setSelfPersonId(selfId);

    const result = vitals.computeOrgVitals();
    expect(result.oneOnOneCoverage.total).toBe(1);
    expect(result.oneOnOneCoverage.uncoveredMembers).toEqual([otherId]);
    expect(result.teams[0].members).toEqual([otherId]);
  });

  // ユーザー要望「チームの状態を自分が管理するチームのみに」対応。
  it("自分が管理していないチーム(managedByEm:false)はTeam Vitalsの対象外", async () => {
    const { vitals, orgStore } = await loadModules();
    const managed = orgStore.addTeam("自チーム", ["Aさん"]);
    const other = orgStore.addTeam("他チーム", ["Bさん"]);
    await orgStore.updateTeam(other.id, { managedByEm: false });

    const result = vitals.computeOrgVitals();
    expect(result.teams.map((t) => t.teamId)).toEqual([managed.id]);
    expect(result.teams[0].managedByEm).toBe(true);
  });

  // ユーザー指摘「バイタルが提案の状況(停滞・確認保留)に対して問題無いように見える」対応。
  it("チームに紐づく確認保留の提案が1件あれば、Journalが良好でもwarn以上に引き上げる", async () => {
    const { vitals, orgStore, journalStore, suggestionStore } = await loadModules();
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    mockExtraction = { summary: "", tags: [], people: ["Aさん"], urgency: "mid", sentiment: "positive",  };
    await journalStore.addJournalEntry("Aさんが好調");
    await journalStore.addJournalEntry("Aさんがまた好調");
    const suggestion = await suggestionStore.createSuggestion("障害対応", { teamId: team.id });
    suggestionStore.setReviewStatus(suggestion.id, "deferred");

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("warn");
    expect(result.teams[0].reason).toContain("確認保留");
  });

  it("チームに紐づく確認保留の提案があっても、既にbad判定なら据え置く", async () => {
    const { vitals, orgStore, journalStore, suggestionStore } = await loadModules();
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    mockExtraction = { summary: "", tags: [], people: ["Aさん"], urgency: "mid", sentiment: "negative",  };
    await journalStore.addJournalEntry("Aさんが不満");
    await journalStore.addJournalEntry("Aさんがまた不満");
    const suggestion = await suggestionStore.createSuggestion("障害対応", { teamId: team.id });
    suggestionStore.setReviewStatus(suggestion.id, "deferred");

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("bad");
  });

  it("アーカイブ済みの確認保留提案は無視する", async () => {
    const { vitals, orgStore, suggestionStore } = await loadModules();
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    const suggestion = await suggestionStore.createSuggestion("障害対応", { teamId: team.id });
    suggestionStore.setReviewStatus(suggestion.id, "deferred");
    suggestionStore.archiveSuggestion(suggestion.id);

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("unknown");
  });
  // ユーザー指摘「確認済み（対応不要）にしたJournalはメンバーのアラート換算から外したい」対応。
  it("確認済み（対応不要）にしたネガティブJournalはTeam Vitalsの判定材料から除外する", async () => {
    const { vitals, orgStore, journalStore } = await loadModules();
    orgStore.addTeam("Team A", ["Aさん"]);
    mockExtraction = { summary: "", tags: [], people: ["Aさん"], urgency: "mid", sentiment: "negative",  };
    const e1 = await journalStore.addJournalEntry("Aさんが不満");
    const e2 = await journalStore.addJournalEntry("Aさんがまた不満");
    await journalStore.setJournalNoActionNeeded(e1.id);
    await journalStore.setJournalNoActionNeeded(e2.id);

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("unknown");
  });

  it("メンバー未登録でも明示teamIdsのJournalが閾値以上ならsentimentで判定する", async () => {
    const { vitals, orgStore, journalStore } = await loadModules();
    orgStore.addTeam("コアチーム", []);
    mockExtraction = { summary: "", tags: [], people: [], urgency: "mid", sentiment: "negative",  };
    await journalStore.addJournalEntry("コアチームの士気が低い");
    await journalStore.addJournalEntry("コアチームがまた落ち込んでいる");

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("bad");
  });

  it("メンバー一致がなくても明示teamIdsだけで関連Journalとして数える（方針A）", async () => {
    const { vitals, orgStore, journalStore } = await loadModules();
    // 別メンバーのチームだが、本文にチーム名があれば明示紐付けされる
    orgStore.addTeam("コアチーム", ["Bさん"]);
    mockExtraction = { summary: "", tags: [], people: [], urgency: "mid", sentiment: "positive",  };
    await journalStore.addJournalEntry("コアチーム全体の雰囲気が良い");
    await journalStore.addJournalEntry("コアチームの進捗が順調");

    const result = vitals.computeOrgVitals();
    expect(result.teams[0].status).toBe("good");
  });
});

describe("computeSuggestionImpact", () => {
  it("チームに紐づいていない提案はundefinedを返す", async () => {
    const { vitals, suggestionStore } = await loadModules();
    const suggestion = await suggestionStore.createSuggestion("チーム未紐付け提案");
    expect(vitals.computeSuggestionImpact(suggestion)).toBeUndefined();
  });

  it("チームにメンバーが居なくてもImpact構造を返す（明示紐付けJournal用・方針A）", async () => {
    const { vitals, suggestionStore, orgStore } = await loadModules();
    const team = orgStore.addTeam("Team A", []);
    const suggestion = await suggestionStore.createSuggestion("提案", { teamId: team.id });
    const impact = vitals.computeSuggestionImpact(suggestion);
    expect(impact).toBeDefined();
    expect(impact?.inProgress).toBe(true);
    expect(impact?.after.total).toBe(0);
  });

  it("メンバー無しでも明示teamIdsのJournalは介入効果に含まれる", async () => {
    const { vitals, suggestionStore, orgStore, journalStore } = await loadModules();
    const team = orgStore.addTeam("コアチーム", []);
    const suggestion = await suggestionStore.createSuggestion("介入提案", { teamId: team.id });
    mockExtraction = { summary: "", tags: [], people: [], urgency: "mid", sentiment: "positive",  };
    await journalStore.addJournalEntry("コアチームの雰囲気が改善した");
    const impact = vitals.computeSuggestionImpact(suggestion);
    expect(impact?.after.total).toBe(1);
  });

  it("未完了の提案はinProgress:trueで、提案作成〜現在を観測窓にする", async () => {
    const { vitals, suggestionStore, orgStore, journalStore } = await loadModules();
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    const suggestion = await suggestionStore.createSuggestion("介入提案", { teamId: team.id });

    mockExtraction = { summary: "", tags: [], people: ["Aさん"], urgency: "mid", sentiment: "positive",  };
    await journalStore.addJournalEntry("介入後の様子");

    const impact = vitals.computeSuggestionImpact(suggestion);
    expect(impact?.inProgress).toBe(true);
    expect(impact?.after.total).toBe(1);
  });

  it("reviewStatus=doneの提案はinProgress:falseで、reviewedAt以降windowDays日間を観測窓にする", async () => {
    const { vitals, suggestionStore, orgStore, journalStore } = await loadModules();
    const team = orgStore.addTeam("Team A", ["Aさん"]);
    const suggestion = await suggestionStore.createSuggestion("介入提案", { teamId: team.id });
    suggestionStore.setReviewStatus(suggestion.id, "done");

    mockExtraction = { summary: "", tags: [], people: ["Aさん"], urgency: "mid", sentiment: "positive",  };
    await journalStore.addJournalEntry("介入後の様子");

    const doneSuggestion = suggestionStore.getSuggestion(suggestion.id)!;
    const impact = vitals.computeSuggestionImpact(doneSuggestion);
    expect(impact?.inProgress).toBe(false);
    expect(impact?.after.total).toBe(1);
  });
});

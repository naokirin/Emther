import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { jsonRequest } from "@core/test-helpers/api-route";

let mockExtraction: {
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
  profileCandidate?: { person: string; text: string } | null;
};

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async (messages: { role: string; content: string }[]) => {
    const systemContent = messages[0]?.content ?? "";
    if (systemContent.includes("人物名だけ")) return JSON.stringify({ people: [] });
    return JSON.stringify(mockExtraction);
  }),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

vi.mock("@/lib/agent-runtime", () => ({
  startRun: vi.fn(async () => ({})),
  listRuns: () => [],
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("GET /api/journal", () => {
  it("空なら空配列", async () => {
    const route = await import("./route");
    const res = await route.GET();
    expect(await res.json()).toEqual({ entries: [] });
  });
});

describe("POST /api/journal", () => {
  it("textが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/api/journal", "POST", { text: "  " }));
    expect(res.status).toBe(400);
  });

  it("記録できる（201）。抽出peopleは登録済みの人物だけ紐付く（自動登録しない）", async () => {
    mockExtraction = { tags: ["1on1"], people: ["Aさん"], urgency: "low", sentiment: "positive", summary: "良かった" };
    const peopleDirectory = await import("@core/people-directory");
    peopleDirectory.registerName("Aさん");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/api/journal", "POST", { text: "Aさんと1on1した" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.entry.tags).toEqual(["1on1"]);
    expect(json.entry.people).toEqual(["Aさん"]); // 実名復元済み
    expect(json.entry.confirmed).toBe(false);
  });

  it("未登録の抽出peopleは自動登録せず空のまま", async () => {
    mockExtraction = { tags: ["1on1"], people: ["新人さん"], urgency: "low", sentiment: "neutral", summary: "1on1した" };
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/journal", "POST", {
        text: "新人さんと1on1した",
        allowUnmaskedNameCandidates: true,
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.entry.people).toEqual([]);
    const peopleDirectory = await import("@core/people-directory");
    expect(peopleDirectory.listPeople()).toHaveLength(0);
  });

  // docs/memo.md「メンバーに登録がない名前をJournalで入力して分析にかけましたが、とくに
  // 引っかからずにAIに渡されてしまいました」対応。データ入力（保存）時点で検出し、
  // 未確認なら保存自体をブロックして確認を求めるように変更した。
  it("人名らしいが未登録の語句があると、確認フラグ無しでは保存をブロックし409で候補を返す", async () => {
    mockExtraction = { tags: ["1on1"], people: [], urgency: "low", sentiment: "neutral", summary: "1on1した" };
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/journal", "POST", { text: "新人さんと1on1した" }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("NAME_CANDIDATE_CONFIRMATION_REQUIRED");
    expect(json.candidates).toEqual(["新人さん"]);
    const peopleDirectory = await import("@core/people-directory");
    expect(peopleDirectory.listPeople()).toHaveLength(0);
  });

  it("allowUnmaskedNameCandidatesで確認済みとして進めると保存できる", async () => {
    mockExtraction = { tags: ["1on1"], people: [], urgency: "low", sentiment: "neutral", summary: "1on1した" };
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/journal", "POST", {
        text: "新人さんと1on1した",
        allowUnmaskedNameCandidates: true,
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    // 未マスクのまま進めることを確認済み（acknowledge）にしたため、保存直後の
    // ヒント（nameCandidates）は空（保存前ダイアログで完結）。
    expect(json.nameCandidates).toEqual([]);
    // 未マスクのまま進めることを許可しただけで、people自体は自動登録しない（既存方針は変えない）。
    expect(json.entry.people).toEqual([]);
    const peopleDirectory = await import("@core/people-directory");
    expect(peopleDirectory.listPeople()).toHaveLength(0);
  });

  it("形態素では拾えないがローカル抽出だけが拾った未登録名でも409で確認を求める", async () => {
    // name-candidate-detect が空でも、抽出 people がゲートに合流する。
    mockExtraction = {
      tags: [],
      people: ["未登録太郎"],
      urgency: "low",
      sentiment: "neutral",
      summary: "",
    };
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/journal", "POST", { text: "未登録太郎さんと話した" }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("NAME_CANDIDATE_CONFIRMATION_REQUIRED");
    expect(json.candidates).toContain("未登録太郎");
  });

  // docs/memo.md「JournalのAIでの分析結果として、メンバーの長期プロファイルに入れる」対応。
  it("既登録の人物についての長期プロファイル候補をprofileCandidateとしてヒントに返す", async () => {
    mockExtraction = {
      tags: [],
      people: ["Aさん"],
      urgency: "low",
      sentiment: "positive",
      summary: "",
      profileCandidate: { person: "Aさん", text: "Aさんはレビューが速く的確" },
    };
    const peopleDirectory = await import("@core/people-directory");
    peopleDirectory.registerName("Aさん");
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/journal", "POST", { text: "Aさんはいつもレビューが速い" }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.profileCandidate).toEqual({ person: "Aさん", text: "Aさんはレビューが速く的確" });
  });

  it("候補が無い・未登録人物のときはprofileCandidateを含まない", async () => {
    mockExtraction = { tags: [], people: [], urgency: "low", sentiment: "neutral", summary: "", profileCandidate: null };
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/api/journal", "POST", { text: "特に何もないメモ" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.profileCandidate).toBeUndefined();
  });

  it("occurredAtDateを指定すると日付レベルで記録される", async () => {
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/journal", "POST", { text: "先日のこと", occurredAtDate: "2026-01-15" }),
    );
    const json = await res.json();
    expect(json.entry.createdAt).toBe(new Date(2026, 0, 15, 12, 0, 0, 0).getTime());
  });

  it("occurredAtDateの形式が不正なら400", async () => {
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/journal", "POST", { text: "テキスト", occurredAtDate: "not-a-date" }),
    );
    expect(res.status).toBe(400);
  });

  it("peopleを明示するとNER抽出が空でも紐付く", async () => {
    mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
    const peopleDirectory = await import("@core/people-directory");
    peopleDirectory.registerName("花子さん");
    const route = await import("./route");
    const res = await route.POST(
      jsonRequest("http://localhost/api/journal", "POST", {
        text: "進捗が遅れている",
        people: ["花子さん"],
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.entry.people).toEqual(["花子さん"]);
  });
});

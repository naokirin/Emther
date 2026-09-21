import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "./test-helpers/store-env";

vi.mock("./local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

// suggestEvaluationLogsFromRecentJournalsのテスト用に、テキストに含まれる目印
// （TOPIC_A/TOPIC_B）に応じてベクトルを変える簡易埋め込み。cosineSimilarityは
// 実装（@core/embeddings）をそのまま使う。
vi.mock("./embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./embeddings")>();
  return {
    ...actual,
    embedText: vi.fn(async (text: string) => {
      if (text.includes("TOPIC_A")) return [1, 0, 0];
      if (text.includes("TOPIC_B")) return [0, 1, 0];
      return [0, 0, 1];
    }),
  };
});

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("person-evaluation-store", () => {
  it("仮置きログを作成し状態遷移できる", async () => {
    const store = await import("./person-evaluation-store");
    const log = await store.createEvaluationLog({
      personId: "PERSON_1",
      lens: "outcome",
      sourceJournalId: "j1",
      snapshotText: "リリースを主導した",
      rationale: "KR達成への寄与候補",
    });
    expect(log.status).toBe("provisional");
    expect(store.listEvaluationLogsForPerson("PERSON_1")).toHaveLength(1);

    const confirmed = store.setEvaluationLogStatus(log.id, "confirmed");
    expect(confirmed?.status).toBe("confirmed");

    const discarded = store.setEvaluationLogStatus(log.id, "discarded");
    expect(discarded?.status).toBe("discarded");
  });

  it("bundle は A/B を分け不足を返す", async () => {
    const store = await import("./person-evaluation-store");
    await store.createEvaluationLog({
      personId: "PERSON_1",
      lens: "outcome",
      sourceJournalId: "j1",
      snapshotText: "成果",
      rationale: "r",
    });
    const bundle = store.bundleEvaluationLogs("PERSON_1");
    expect(bundle.outcome).toHaveLength(1);
    expect(bundle.value).toHaveLength(0);
    expect(bundle.missing).toContain("Value 体現ログが不足");
  });

  it("suggest-from-journalは意味的に関連するFactだけを仮置きする（Objectives削除に伴いvalueレンズのみ自動照合）", async () => {
    const store = await import("./person-evaluation-store");
    const { recordEvent } = await import("./knowledge-store");
    const { updateOrgStrategy } = await import("./org-context-store/index");

    await updateOrgStrategy({ values: "TOPIC_B というValue" });

    // Valueに関連するFact
    recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: ["PERSON_1"],
      text: "TOPIC_B を体現した",
      tags: [],
      occurredAt: Date.now(),
      embedding: [0, 1, 0],
    });
    // Valueに無関係なFact
    recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: ["PERSON_1"],
      text: "無関係な出来事",
      tags: [],
      occurredAt: Date.now(),
      embedding: [0, 0, 1],
    });

    const created = await store.suggestEvaluationLogsFromRecentJournals("PERSON_1", "太郎");

    const outcomeLogs = created.filter((l) => l.lens === "outcome");
    const valueLogs = created.filter((l) => l.lens === "value");
    // outcomeレンズの自動照合は撤去済み（照合先のObjectivesが無い）。
    expect(outcomeLogs).toHaveLength(0);
    expect(valueLogs).toHaveLength(1);
    expect(valueLogs[0].valueSnapshot).toBe("TOPIC_B というValue");
    // 無関係なFactからは仮置きされない
    expect(created).toHaveLength(1);
  });

  it("懸念(polarity: concern)を確認済み（対応不要）にでき、取り消せる", async () => {
    const store = await import("./person-evaluation-store");
    const log = await store.createEvaluationLog({
      personId: "PERSON_1",
      lens: "outcome",
      polarity: "concern",
      sourceJournalId: "j1",
      snapshotText: "懸念のある出来事",
      rationale: "r",
    });

    const acked = await store.setEvaluationLogNoActionNeeded(log.id, "確認済み・対応不要");
    expect(acked?.polarity).toBe("concern"); // polarity自体は書き換えない
    expect(acked?.noActionNeededAt).toBeDefined();
    expect(acked?.noActionNeededNote).toBe("確認済み・対応不要");

    const cleared = store.clearEvaluationLogNoActionNeeded(log.id);
    expect(cleared?.noActionNeededAt).toBeUndefined();
    expect(cleared?.noActionNeededNote).toBeUndefined();
  });

  it("suggest-from-journalは埋め込みの無いFactを仮置きしない（関連性を確認できないため）", async () => {
    const store = await import("./person-evaluation-store");
    const { recordEvent } = await import("./knowledge-store");
    const { updateOrgStrategy } = await import("./org-context-store/index");

    await updateOrgStrategy({ values: "TOPIC_B というValue" });

    recordEvent({
      kind: "fact",
      context: "observation",
      entityType: "journal",
      people: ["PERSON_1"],
      text: "TOPIC_A に取り組んだが埋め込みは未生成",
      tags: [],
      occurredAt: Date.now(),
      // embeddingを持たせない（生成失敗を模す）
    });

    const created = await store.suggestEvaluationLogsFromRecentJournals("PERSON_1", "太郎");
    expect(created).toHaveLength(0);
  });
});

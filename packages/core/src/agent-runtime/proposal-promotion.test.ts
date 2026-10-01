import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "../test-helpers/store-env";

vi.mock("../local-model", () => ({
  runLocalChat: vi.fn(async () => JSON.stringify({ people: [] })),
  extractFirstJsonObject: (text: string) => text,
}));

const embedRef = vi.hoisted(() => ({
  impl: async (_text: string): Promise<number[]> => {
    void _text;
    return [1, 0, 0];
  },
}));

vi.mock("../embeddings", () => ({
  embedText: (text: string) => embedRef.impl(text),
  cosineSimilarity: (a: number[], b: number[]) => {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  },
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  embedRef.impl = async () => [1, 0, 0];
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

function idlePromoteRun(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: "run-promote-1",
    agentName: "Lead Agent",
    task: "分析",
    status: "idle" as const,
    log: [],
    totalCostUsd: 0,
    createdAt: now,
    updatedAt: now,
    origin: "auto-anomaly" as const,
    reviewed: false,
    proposal: {
      conclusion: "課題がある",
      facts: ["f"],
      logic: "l",
      rejectedAlternatives: [],
      expansions: [],
      challenges: [],
      explorations: [],
      recommendation: "suggestion" as const,
      suggestionTitle: "1on1の効果が薄い",
    },
    ...overrides,
  };
}

describe("proposal-promotion 同趣旨スキップ", () => {
  it("類似オープン提案があり新観測が無ければ自動起票をスキップする", async () => {
    const suggestionStore = await import("../suggestion-store");
    const { runs } = await import("./store");
    const { autoPromoteRunProposal } = await import("./proposal-promotion");

    const existing = await suggestionStore.createSuggestion("1on1が機能していない");
    suggestionStore.persistSuggestionEmbedding(existing.id, [1, 0, 0]);

    const run = idlePromoteRun({ sourceJournalId: undefined });
    runs.set(run.id, run);

    const created = await autoPromoteRunProposal(run.id);
    expect(created).toBe(0);
    expect(suggestionStore.listSuggestions().filter((s) => s.sourceRunId === run.id)).toHaveLength(0);
    expect(runs.get(run.id)?.log.some((l) => l.text.includes("自動起票をスキップ"))).toBe(true);
  });

  it("類似オープン提案でも未リンクのsourceJournalがあれば再提案する", async () => {
    const suggestionStore = await import("../suggestion-store");
    const journalStore = await import("../journal-store");
    const { runs } = await import("./store");
    const { autoPromoteRunProposal } = await import("./proposal-promotion");

    const existing = await suggestionStore.createSuggestion("1on1が機能していない");
    suggestionStore.persistSuggestionEmbedding(existing.id, [1, 0, 0]);

    const journal = await journalStore.addJournalEntry("また1on1が空回りした");
    const run = idlePromoteRun({ sourceJournalId: journal.id });
    runs.set(run.id, run);

    const created = await autoPromoteRunProposal(run.id);
    expect(created).toBe(1);
    const promoted = suggestionStore.listSuggestions().filter((s) => s.sourceRunId === run.id);
    expect(promoted).toHaveLength(1);
    expect(promoted[0].title).toBe("1on1の効果が薄い");
    expect(promoted[0].autoCreated).toBe(true);
  });

  it("sourceJournalが既に類似提案へリンク済みならスキップする", async () => {
    const suggestionStore = await import("../suggestion-store");
    const journalStore = await import("../journal-store");
    const { runs } = await import("./store");
    const { autoPromoteRunProposal } = await import("./proposal-promotion");

    const journal = await journalStore.addJournalEntry("1on1が空回りした");
    const existing = await suggestionStore.createSuggestion("1on1が機能していない", {
      sourceJournalId: journal.id,
    });
    suggestionStore.persistSuggestionEmbedding(existing.id, [1, 0, 0]);
    await journalStore.linkJournalToSuggestion(journal.id, existing.id);

    const run = idlePromoteRun({ sourceJournalId: journal.id });
    runs.set(run.id, run);

    const created = await autoPromoteRunProposal(run.id);
    expect(created).toBe(0);
    expect(suggestionStore.listSuggestions().filter((s) => s.sourceRunId === run.id)).toHaveLength(0);
  });

  it("類似が無ければ従来どおり自動起票する", async () => {
    const suggestionStore = await import("../suggestion-store");
    const { runs } = await import("./store");
    const { autoPromoteRunProposal } = await import("./proposal-promotion");

    const existing = await suggestionStore.createSuggestion("全然別の課題");
    suggestionStore.persistSuggestionEmbedding(existing.id, [0, 1, 0]);

    const run = idlePromoteRun();
    runs.set(run.id, run);

    const created = await autoPromoteRunProposal(run.id);
    expect(created).toBe(1);
    expect(suggestionStore.listSuggestions().some((s) => s.sourceRunId === run.id)).toBe(true);
  });
});

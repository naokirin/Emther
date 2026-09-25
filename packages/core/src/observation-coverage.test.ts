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

vi.mock("./name-candidate-detect", () => ({
  detectNameCandidatesAsync: async () => [] as string[],
  detectNameCandidates: () => [] as string[],
  registerNameCandidateFilters: () => {},
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("observation-coverage", () => {
  it("データが空ならブロックを省略する", async () => {
    const { buildObservationCoverageBlock } = await import("./agent-runtime/observation-coverage");
    expect(buildObservationCoverageBlock()).toBe("");
  });

  it("Goal未ヒットとDrift候補を要約に載せる", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 8, 25, 12, 0, 0);
    const journal = await import("./journal-store");
    const org = await import("./org-context-store/index");
    const themes = await import("./theme-store");

    await org.addGoal({ title: "User Valueを高める" });
    const candidate = await themes.createThemeCandidate({
      title: "チーム間連携",
      summary: "他チームとの依存がボトルネック",
      rationale: "過去の記録から",
      facts: ["f"],
    });
    await themes.adoptTheme(candidate.id);

    // 直前窓（15〜42日前）: 連携の記録あり
    await journal.addJournalEntry("他チームとのチーム間連携が滞っている", now - 20 * DAY, {
      prefetchedStructured: { tags: ["連携"], people: [], urgency: "mid", sentiment: "neutral" },
    });
    // 直近窓: 開発速度に偏る
    await journal.addJournalEntry("生成AIで開発速度を上げたい", now - 2 * DAY, {
      prefetchedStructured: { tags: ["開発速度"], people: [], urgency: "mid", sentiment: "neutral" },
    });
    await journal.addJournalEntry("AIエージェント活用を進める", now - 1 * DAY, {
      prefetchedStructured: { tags: ["開発速度"], people: [], urgency: "mid", sentiment: "neutral" },
    });

    const { buildObservationCoverageBlock, computeObservationCoverage } = await import(
      "./agent-runtime/observation-coverage"
    );
    const snap = computeObservationCoverage(now);
    expect(snap.recentJournalCount).toBe(2);
    expect(snap.priorJournalCount).toBe(1);
    expect(snap.topRecentTags.some((t) => t.tag.includes("開発速度"))).toBe(true);

    const goalHit = snap.goals.find((g) => g.label.includes("User Value"));
    expect(goalHit?.recentHits).toBe(0);

    const driftTheme = snap.driftCandidates.find((d) => d.kind === "theme" && d.label.includes("チーム間連携"));
    expect(driftTheme).toBeTruthy();

    const block = buildObservationCoverageBlock(now);
    expect(block).toContain("観測カバレッジ要約");
    expect(block).toContain("User Valueを高める");
    expect(block).toContain("直近ヒット0の軸");
    expect(block).toContain("Drift候補");
    expect(block).toContain("チーム間連携");
    expect(block).toContain("重要課題の断定には使わない");
  });
});

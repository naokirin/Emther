import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@/lib/test-helpers/api-route";

let mockExtraction: {
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
};

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async (messages: { role: string; content: string }[]) => {
    const systemContent = messages[0]?.content ?? "";
    if (systemContent.includes("人物名だけ")) return JSON.stringify({ people: [] });
    return JSON.stringify(mockExtraction);
  }),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

const startJournalAnalysisMock = vi.fn(async (rawText: string, journalId?: string) => ({
  id: "run-analyze",
  agentName: "Lead Agent",
  task: `対象のJournalエントリ: "${rawText}"`,
  status: "active",
  log: [],
  totalCostUsd: 0,
  createdAt: 1,
  updatedAt: 1,
  origin: "auto-anomaly",
  reviewed: false,
  sourceJournalId: journalId,
}));

vi.mock("@/lib/agent-runtime", () => ({
  startJournalAnalysis: (...args: unknown[]) => startJournalAnalysisMock(...(args as [string, string?])),
  startJournalAutoAnalysis: vi.fn(async () => undefined),
  listRuns: () => [],
  toRunView: <T,>(run: T) => run,
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
  mockExtraction = { tags: [], people: [], urgency: "mid", sentiment: "neutral", summary: "" };
  startJournalAnalysisMock.mockClear();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("POST /api/journal/[id]/analyze", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("未確認エントリは400", async () => {
    const journalStore = await import("@/lib/journal-store");
    const entry = await journalStore.addJournalEntry("未確認のまま");
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: entry.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/未確認/);
    expect(startJournalAnalysisMock).not.toHaveBeenCalled();
  });

  it("確定済みなら手動分析を起動して201を返す", async () => {
    const journalStore = await import("@/lib/journal-store");
    const entry = await journalStore.addJournalEntry("分析対象");
    const confirmed = await journalStore.updateJournalEntry(entry.id, { urgency: "low" });
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", {}), routeCtx({ id: confirmed!.id }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.run.id).toBe("run-analyze");
    expect(json.entry.sourceConsultRunId).toBe("run-analyze");
    expect(startJournalAnalysisMock).toHaveBeenCalled();
  });
});

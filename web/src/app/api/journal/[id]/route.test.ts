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

vi.mock("@/lib/agent-runtime", () => ({
  startRun: vi.fn(async () => ({})),
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

describe("PATCH /api/journal/[id]", () => {
  it("存在しないIDは404", async () => {
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { tags: ["x"] }), routeCtx({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("rawTextを空にしようとすると400", async () => {
    const journalStore = await import("@/lib/journal-store");
    const entry = await journalStore.addJournalEntry("元のテキスト");
    const route = await import("./route");
    const res = await route.PATCH(jsonRequest("http://localhost/x", "PATCH", { rawText: "  " }), routeCtx({ id: entry.id }));
    expect(res.status).toBe(400);
  });

  it("occurredAtDateの形式が不正なら400", async () => {
    const journalStore = await import("@/lib/journal-store");
    const entry = await journalStore.addJournalEntry("テキスト");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { occurredAtDate: "invalid" }),
      routeCtx({ id: entry.id }),
    );
    expect(res.status).toBe(400);
  });

  it("校正できる（tags/urgency/occurredAtDate）", async () => {
    const journalStore = await import("@/lib/journal-store");
    const entry = await journalStore.addJournalEntry("テキスト");
    const route = await import("./route");
    const res = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { tags: ["確認済み"], urgency: "high", occurredAtDate: "2026-01-15" }),
      routeCtx({ id: entry.id }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entry.tags).toEqual(["確認済み"]);
    expect(json.entry.urgency).toBe("high");
    expect(json.entry.createdAt).toBe(new Date(2026, 0, 15, 12, 0, 0, 0).getTime());
    expect(json.entry.confirmed).toBe(true);
  });

  it("resolvedIssueId/resolutionNoteの3値（未指定=維持・null=解除・文字列=設定）", async () => {
    const journalStore = await import("@/lib/journal-store");
    const entry = await journalStore.addJournalEntry("問題発生");
    const route = await import("./route");

    const withResolution = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { resolvedIssueId: "issue-1" }),
      routeCtx({ id: entry.id }),
    );
    const withResolutionJson = await withResolution.json();
    expect(withResolutionJson.entry.resolvedIssueId).toBe("issue-1");

    const untouched = await route.PATCH(
      jsonRequest("http://localhost/x", "PATCH", { tags: ["x"] }),
      routeCtx({ id: withResolutionJson.entry.id }),
    );
    expect((await untouched.json()).entry.resolvedIssueId).toBe("issue-1");
  });
});

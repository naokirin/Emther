import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest } from "@/lib/test-helpers/api-route";

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

  it("記録できる（201）", async () => {
    mockExtraction = { tags: ["1on1"], people: ["Aさん"], urgency: "low", sentiment: "positive", summary: "良かった" };
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/api/journal", "POST", { text: "Aさんと1on1した" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.entry.tags).toEqual(["1on1"]);
    expect(json.entry.people).toEqual(["Aさん"]); // 実名復元済み
    expect(json.entry.confirmed).toBe(false);
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
});

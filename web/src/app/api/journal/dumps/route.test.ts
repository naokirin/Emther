import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@/lib/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@/lib/test-helpers/api-route";

vi.mock("@/lib/local-model", () => ({
  runLocalChat: vi.fn(async () =>
    JSON.stringify({ tags: ["handoff"], people: [], urgency: "mid", sentiment: "neutral", summary: "" }),
  ),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@/lib/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

vi.mock("@/lib/agent-runtime", () => ({
  startRun: vi.fn(async () => ({})),
  listRuns: () => [],
}));

vi.mock("@/lib/cloud-chat", () => ({
  runCloudChat: vi.fn(async () => {
    throw new Error("cloud unavailable");
  }),
}));

let dir: string;

beforeEach(() => {
  dir = setupIsolatedStoreEnv();
  vi.resetModules();
});

afterEach(() => {
  teardownIsolatedStoreEnv(dir);
});

describe("POST /api/journal/dumps", () => {
  it("sourceTypeとtextが無ければ400", async () => {
    const route = await import("./route");
    const res = await route.POST(jsonRequest("http://localhost/x", "POST", { text: "hi" }));
    expect(res.status).toBe(400);
  });

  it("取り込んでヒューリスティック分割し、採用でJournalになる", async () => {
    const route = await import("./route");
    const createRes = await route.POST(
      jsonRequest("http://localhost/x", "POST", {
        sourceType: "meeting_log",
        title: "週次",
        text: ["決定: 来週リリースを延期する。", "", "未決: 人員の補充時期。"].join("\n"),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.dump.sourceType).toBe("meeting_log");
    expect(created.dump.parseSource).toBe("heuristic");
    expect(created.dump.chunkDrafts.length).toBeGreaterThanOrEqual(2);

    const dumpId = created.dump.id as string;
    const chunkIds = created.dump.chunkDrafts.map((c: { id: string }) => c.id);

    const acceptRoute = await import("./[id]/accept/route");
    const acceptRes = await acceptRoute.POST(
      jsonRequest("http://localhost/x", "POST", { chunkIds }),
      routeCtx({ id: dumpId }),
    );
    expect(acceptRes.status).toBe(201);
    const accepted = await acceptRes.json();
    expect(accepted.entries).toHaveLength(chunkIds.length);
    expect(accepted.entries[0].sourceDumpId).toBe(dumpId);
    expect(accepted.dump.status).toBe("done");
  });

  it("Slack JSONLを平文化して取り込む", async () => {
    const route = await import("./route");
    const jsonl = [
      '{"ts":"1779408841.980299","channel":"test_channel","sender":"taro.tanaka","text":"PBIを進めています","permalink":"https://example.com/a"}',
      '{"ts":"1779677010.661189","channel":"test_channel","sender":"taro.tanaka","text":"ログ改善を考える","permalink":"https://example.com/b"}',
    ].join("\n");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", {
        sourceType: "chat_log",
        text: jsonl,
        parse: false,
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.dump.rawText).toContain("#test_channel taro.tanaka");
    expect(json.dump.rawText).toContain("PBIを進めています");
    expect(json.dump.rawText).not.toContain('"ts":');
    expect(json.dump.occurredRangeHint?.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.dump.droppedNotes.some((n: string) => n.includes("JSONL"))).toBe(true);
  });
});

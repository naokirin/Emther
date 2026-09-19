import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@core/test-helpers/store-env";
import { jsonRequest, routeCtx } from "@core/test-helpers/api-route";

vi.mock("@core/local-model", () => ({
  runLocalChat: vi.fn(async () =>
    JSON.stringify({ tags: ["handoff"], people: [], urgency: "mid", sentiment: "neutral", summary: "" }),
  ),
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

vi.mock("@core/cloud-chat", () => ({
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
    // docs/memo.md「メンバーに登録がない名前をJournalで入力して分析にかけましたが、とくに
    // 引っかからずにAIに渡されてしまいました」対応で採用時にも確認ゲートがかかるようになった
    // ため、この統合テスト自体は採用の仕組み（分割→採用でJournalになる）の検証が主眼であり、
    // 未登録人名の確認フローは下の専用テストで見るので、ここでは確認済みとして進める。
    const acceptRes = await acceptRoute.POST(
      jsonRequest("http://localhost/x", "POST", { chunkIds, allowUnmaskedNameCandidates: true }),
      routeCtx({ id: dumpId }),
    );
    expect(acceptRes.status).toBe(201);
    const accepted = await acceptRes.json();
    expect(accepted.entries).toHaveLength(chunkIds.length);
    expect(accepted.entries[0].sourceDumpId).toBe(dumpId);
    expect(accepted.dump.status).toBe("done");
  });

  it("採用しようとしたチャンクに未登録の人名らしい語句があれば、確認フラグ無しでは409でブロックする", async () => {
    const route = await import("./route");
    const createRes = await route.POST(
      jsonRequest("http://localhost/x", "POST", {
        sourceType: "meeting_log",
        title: "週次",
        text: ["決定: 田中さんが来週から担当する。"].join("\n"),
      }),
    );
    const created = await createRes.json();
    const dumpId = created.dump.id as string;
    const chunkIds = created.dump.chunkDrafts.map((c: { id: string }) => c.id);

    const acceptRoute = await import("./[id]/accept/route");
    const acceptRes = await acceptRoute.POST(
      jsonRequest("http://localhost/x", "POST", { chunkIds }),
      routeCtx({ id: dumpId }),
    );
    expect(acceptRes.status).toBe(409);
    const json = await acceptRes.json();
    expect(json.code).toBe("NAME_CANDIDATE_CONFIRMATION_REQUIRED");
    expect(json.candidates).toContain("田中さん");
  });

  it("Slack JSONLはマッピング無しだと400", async () => {
    const route = await import("./route");
    const jsonl = [
      '{"ts":"1779408841.980299","channel":"test_channel","sender":"taro.tanaka","text":"PBIを進めています"}',
    ].join("\n");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", {
        sourceType: "chat_log",
        text: jsonl,
        parse: false,
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/列を確認する/);
  });

  it("Slack JSONLを列マッピング付きで取り込む", async () => {
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
        mapping: {
          syntax: "jsonl",
          tsKind: "slack",
          fieldMapping: {
            ts: "ts",
            channel: "channel",
            sender: "sender",
            text: "text",
            permalink: "permalink",
          },
        },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.dump.rawText).toContain("#test_channel taro.tanaka");
    expect(json.dump.rawText).toContain("PBIを進めています");
    expect(json.dump.rawText).not.toContain('"ts":');
    expect(json.dump.occurredRangeHint?.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.dump.importMapping?.syntax).toBe("jsonl");
  });

  it("列マッピング付きTSVを取り込む", async () => {
    const route = await import("./route");
    const tsv = ["time\tfrom\tbody", "1779408841\ttarou\t進捗です"].join("\n");
    const res = await route.POST(
      jsonRequest("http://localhost/x", "POST", {
        sourceType: "chat_log",
        text: tsv,
        parse: false,
        mapping: {
          syntax: "tsv",
          hasHeader: true,
          tsKind: "unix_seconds",
          fieldMapping: { time: "ts", from: "sender", body: "text" },
        },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.dump.rawText).toContain("tarou");
    expect(json.dump.rawText).toContain("進捗です");
    expect(json.dump.importMapping?.syntax).toBe("tsv");
  });
});

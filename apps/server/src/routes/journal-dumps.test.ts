import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "@emther/core/test-helpers/store-env";

vi.mock("@emther/core/local-model", () => ({
  runLocalChat: vi.fn(async () =>
    JSON.stringify({ tags: ["handoff"], people: [], urgency: "mid", sentiment: "neutral", summary: "" }),
  ),
  extractFirstJsonObject: (text: string) => text,
}));

vi.mock("@emther/core/embeddings", () => ({
  embedText: vi.fn(async () => [1, 0, 0]),
  cosineSimilarity: () => 0,
}));

vi.mock("@emther/core/agent-runtime/index", () => ({
  startRun: vi.fn(async () => ({})),
  listRuns: () => [],
}));

vi.mock("@emther/core/cloud-chat", () => ({
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

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function patch(body: unknown) {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("POST /api/journal/dumps", () => {
  it("sourceTypeとtextが無ければ400", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const res = await journalDumpsRoute.request("/", post({ text: "hi" }));
    expect(res.status).toBe(400);
  });

  it("取り込んでヒューリスティック分割し、採用でJournalになる", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const createRes = await journalDumpsRoute.request(
      "/",
      post({
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
    expect(created.dump.prependTitleToJournals).toBeUndefined();

    const dumpId = created.dump.id as string;
    const chunkIds = created.dump.chunkDrafts.map((c: { id: string }) => c.id);

    // 未登録人名の確認は下の専用テストで見る。ここでは確認済みフラグで採用の仕組み（分割→Journal）だけ検証する。
    const acceptRes = await journalDumpsRoute.request(`/${dumpId}/accept`, post({ chunkIds, allowUnmaskedNameCandidates: true }));
    expect(acceptRes.status).toBe(201);
    const accepted = await acceptRes.json();
    expect(accepted.entries).toHaveLength(chunkIds.length);
    expect(accepted.entries[0].sourceDumpId).toBe(dumpId);
    expect(accepted.entries[0].rawText).not.toMatch(/^\[週次\]/);
    expect(accepted.dump.status).toBe("done");
  });

  it("prependTitleToJournals:trueなら採用Journalの先頭に[タイトル]が付く（プレビュー原文はそのまま）", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const createRes = await journalDumpsRoute.request(
      "/",
      post({
        sourceType: "meeting_log",
        title: "9/10 週次",
        prependTitleToJournals: true,
        text: ["決定: 来週リリースを延期する。", "", "未決: 人員の補充時期。"].join("\n"),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.dump.prependTitleToJournals).toBe(true);
    expect(created.dump.chunkDrafts[0].text).not.toMatch(/^\[9\/10 週次\]/);

    const dumpId = created.dump.id as string;
    const chunkIds = created.dump.chunkDrafts.map((c: { id: string }) => c.id);
    const acceptRes = await journalDumpsRoute.request(
      `/${dumpId}/accept`,
      post({ chunkIds, allowUnmaskedNameCandidates: true }),
    );
    expect(acceptRes.status).toBe(201);
    const accepted = await acceptRes.json();
    expect(accepted.entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of accepted.entries as { rawText: string }[]) {
      expect(entry.rawText.startsWith("[9/10 週次] ")).toBe(true);
    }
  });

  it("タイトル無しでprependTitleToJournals:trueでもフラグは保存されない", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const createRes = await journalDumpsRoute.request(
      "/",
      post({
        sourceType: "other_log",
        prependTitleToJournals: true,
        text: "メモ本文だけ",
        parse: false,
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.dump.prependTitleToJournals).toBeUndefined();
  });

  it("採用しようとしたチャンクに未登録の人名らしい語句があれば、確認フラグ無しでは409でブロックする", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const createRes = await journalDumpsRoute.request(
      "/",
      post({ sourceType: "meeting_log", title: "週次", text: ["決定: 田中さんが来週から担当する。"].join("\n") }),
    );
    const created = await createRes.json();
    const dumpId = created.dump.id as string;
    const chunkIds = created.dump.chunkDrafts.map((c: { id: string }) => c.id);

    const acceptRes = await journalDumpsRoute.request(`/${dumpId}/accept`, post({ chunkIds }));
    expect(acceptRes.status).toBe(409);
    const json = await acceptRes.json();
    expect(json.code).toBe("NAME_CANDIDATE_CONFIRMATION_REQUIRED");
    expect(json.candidates).toContain("田中さん");
  });

  it("Slack JSONLはマッピング無しだと400", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const jsonl = ['{"ts":"1779408841.980299","channel":"test_channel","sender":"taro.tanaka","text":"PBIを進めています"}'].join("\n");
    const res = await journalDumpsRoute.request("/", post({ sourceType: "chat_log", text: jsonl, parse: false }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/列を確認する/);
  });

  it("Slack JSONLを列マッピング付きで取り込む", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const jsonl = [
      '{"ts":"1779408841.980299","channel":"test_channel","sender":"taro.tanaka","text":"PBIを進めています","permalink":"https://example.com/a"}',
      '{"ts":"1779677010.661189","channel":"test_channel","sender":"taro.tanaka","text":"ログ改善を考える","permalink":"https://example.com/b"}',
    ].join("\n");
    const res = await journalDumpsRoute.request(
      "/",
      post({
        sourceType: "chat_log",
        text: jsonl,
        parse: false,
        mapping: {
          syntax: "jsonl",
          tsKind: "slack",
          fieldMapping: { ts: "ts", channel: "channel", sender: "sender", text: "text", permalink: "permalink" },
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
    const { journalDumpsRoute } = await import("./journal-dumps");
    const tsv = ["time\tfrom\tbody", "1779408841\ttarou\t進捗です"].join("\n");
    const res = await journalDumpsRoute.request(
      "/",
      post({
        sourceType: "chat_log",
        text: tsv,
        parse: false,
        mapping: { syntax: "tsv", hasHeader: true, tsKind: "unix_seconds", fieldMapping: { time: "ts", from: "sender", body: "text" } },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.dump.rawText).toContain("tarou");
    expect(json.dump.rawText).toContain("進捗です");
    expect(json.dump.importMapping?.syntax).toBe("tsv");
  });
});

describe("GET /api/journal/dumps/:id", () => {
  it("存在しないIDは404", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const res = await journalDumpsRoute.request("/missing");
    expect(res.status).toBe(404);
  });

  it("取得できる", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const created = await journalDumpsRoute.request("/", post({ sourceType: "other_log", text: "メモ本文", parse: false }));
    const { dump } = await created.json();
    const res = await journalDumpsRoute.request(`/${dump.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).dump.id).toBe(dump.id);
  });
});

describe("PATCH /api/journal/dumps/:id", () => {
  it("存在しないIDは404", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const res = await journalDumpsRoute.request("/missing", patch({}));
    expect(res.status).toBe(404);
  });

  it("discard:trueで破棄できる", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const created = await journalDumpsRoute.request(
      "/",
      post({ sourceType: "meeting_log", text: "決定: 何かを決めた。", parse: false }),
    );
    const { dump } = await created.json();
    const res = await journalDumpsRoute.request(`/${dump.id}`, patch({ discard: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).dump.status).toBe("discarded");
  });

  it("chunksでdispositionを更新できる", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const created = await journalDumpsRoute.request(
      "/",
      post({ sourceType: "meeting_log", text: ["決定: 来週リリースを延期する。", "", "未決: 人員の補充時期。"].join("\n") }),
    );
    const { dump } = await created.json();
    const chunkId = dump.chunkDrafts[0].id as string;
    const res = await journalDumpsRoute.request(`/${dump.id}`, patch({ chunks: [{ id: chunkId, disposition: "drop" }] }));
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.dump.chunkDrafts.find((c: { id: string }) => c.id === chunkId)?.disposition).toBe("drop");
  });
});

describe("POST /api/journal/dumps/:id/parse", () => {
  it("存在しないIDは404", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const res = await journalDumpsRoute.request("/missing/parse", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("再分割できる", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const created = await journalDumpsRoute.request(
      "/",
      post({ sourceType: "meeting_log", text: "決定: 何かを決めた。", parse: false }),
    );
    const { dump } = await created.json();
    expect(dump.chunkDrafts).toEqual([]);
    const res = await journalDumpsRoute.request(`/${dump.id}/parse`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).dump.chunkDrafts.length).toBeGreaterThan(0);
  });
});

describe("POST /api/journal/dumps/preview", () => {
  it("textが無ければ400", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const res = await journalDumpsRoute.request("/preview", post({ text: "  " }));
    expect(res.status).toBe(400);
  });

  it("構文・プロファイル一覧を返す（保存しない）", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const res = await journalDumpsRoute.request("/preview", post({ text: "決定: 何か。" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.preview).toBeDefined();
    expect(json.profiles).toEqual([]);

    const list = await journalDumpsRoute.request("/");
    expect((await list.json()).dumps).toEqual([]);
  });
});

describe("/api/journal/dumps/profiles", () => {
  it("GETは既定で空配列", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const res = await journalDumpsRoute.request("/profiles");
    expect(await res.json()).toEqual({ profiles: [] });
  });

  it("nameが無ければ400", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const res = await journalDumpsRoute.request(
      "/profiles",
      post({ config: { syntax: "tsv", hasHeader: true, tsKind: "unix_seconds", fieldMapping: {} } }),
    );
    expect(res.status).toBe(400);
  });

  it("保存・削除できる", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const saveRes = await journalDumpsRoute.request(
      "/profiles",
      post({ name: "Slackエクスポート", config: { syntax: "jsonl", tsKind: "slack", fieldMapping: { ts: "ts", text: "text" } } }),
    );
    expect(saveRes.status).toBe(201);
    const { profile } = await saveRes.json();
    expect(profile.name).toBe("Slackエクスポート");

    const listRes = await journalDumpsRoute.request("/profiles");
    expect((await listRes.json()).profiles).toHaveLength(1);

    const delRes = await journalDumpsRoute.request("/profiles", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: profile.id }) });
    expect(delRes.status).toBe(200);

    const listAfter = await journalDumpsRoute.request("/profiles");
    expect((await listAfter.json()).profiles).toEqual([]);
  });

  it("存在しないidの削除は404", async () => {
    const { journalDumpsRoute } = await import("./journal-dumps");
    const res = await journalDumpsRoute.request("/profiles", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });
});

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

async function addEntry(text: string, opts?: { extraction?: Partial<typeof mockExtraction>; occurredAtDate?: string }) {
  if (opts?.extraction) mockExtraction = { ...mockExtraction, ...opts.extraction };
  const postRoute = await import("../route");
  const body: Record<string, unknown> = { text };
  if (opts?.occurredAtDate) body.occurredAtDate = opts.occurredAtDate;
  const res = await postRoute.POST(jsonRequest("http://localhost/api/journal", "POST", body));
  return (await res.json()).entry as { id: string };
}

describe("GET /api/journal/search", () => {
  it("既定はpageSize=10でentries/total/facetsを返す", async () => {
    await addEntry("1件目");
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/api/journal/search"));
    const json = await res.json();
    expect(json.entries).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.pageSize).toBe(10);
    expect(json.facets).toEqual({ tags: [], people: [] });
  });

  it("page/pageSizeクエリでページ送りする", async () => {
    await addEntry("1件目");
    await addEntry("2件目");
    await addEntry("3件目");
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/api/journal/search?pageSize=1&page=2"));
    const json = await res.json();
    expect(json.entries).toHaveLength(1);
    expect(json.total).toBe(3);
    expect(json.page).toBe(2);
  });

  it("urgency/sentimentクエリで絞り込み、facetsに実名・実タグが載る", async () => {
    // ローカル抽出の人物は既登録のみ紐付く（自動登録しない）ため、先に名簿へ載せる。
    const peopleDirectory = await import("@/lib/people-directory");
    peopleDirectory.registerName("Aさん");
    await addEntry("Aさんと1on1した", { extraction: { tags: ["1on1"], people: ["Aさん"], urgency: "high", sentiment: "positive" } });
    await addEntry("普通の話", { extraction: { tags: [], people: [], urgency: "low", sentiment: "neutral" } });
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/api/journal/search?urgency=high&sentiment=positive"));
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.facets.tags).toContain("1on1");
    expect(json.facets.people).toContain("Aさん");
  });

  it("不正なurgency/sentiment値は無視する", async () => {
    await addEntry("1件目");
    const route = await import("./route");
    const res = await route.GET(new Request("http://localhost/api/journal/search?urgency=bogus"));
    const json = await res.json();
    expect(json.total).toBe(1);
  });

  it("focusIdを渡すと、そのエントリが載っているページ番号を返す", async () => {
    await addEntry("1件目（新しい）", { occurredAtDate: "2026-01-02" });
    const target = await addEntry("2件目（古い）", { occurredAtDate: "2026-01-01" });
    const route = await import("./route");
    const res = await route.GET(new Request(`http://localhost/api/journal/search?pageSize=1&focusId=${target.id}`));
    const json = await res.json();
    expect(json.page).toBe(2);
    expect(json.entries[0].id).toBe(target.id);
  });
});

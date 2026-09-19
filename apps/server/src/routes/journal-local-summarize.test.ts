import { describe, expect, it, vi } from "vitest";

vi.mock("@emther/core/local-summarizer", () => ({
  summarizeLogLocally: vi.fn(async (text: string) => `[要約ログ] ${text}`),
  structureDailyReflectionLocally: vi.fn(async (text: string) => `[振り返り構造化] ${text}`),
}));

function post(body: unknown) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("POST /api/journal/local-summarize", () => {
  it("textが空なら400を返す", async () => {
    const { journalLocalSummarizeRoute } = await import("./journal-local-summarize");
    const res = await journalLocalSummarizeRoute.request("/", post({ text: "  " }));
    expect(res.status).toBe(400);
  });

  it("mode=logで要約を返す", async () => {
    const { journalLocalSummarizeRoute } = await import("./journal-local-summarize");
    const res = await journalLocalSummarizeRoute.request("/", post({ text: "議事録テキスト", mode: "log" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBe("[要約ログ] 議事録テキスト");
  });

  it("mode=reflectionで振り返り構造化を返す", async () => {
    const { journalLocalSummarizeRoute } = await import("./journal-local-summarize");
    const res = await journalLocalSummarizeRoute.request("/", post({ text: "今日の振り返り", mode: "reflection" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBe("[振り返り構造化] 今日の振り返り");
  });
});

import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@core/local-summarizer", () => ({
  summarizeLogLocally: vi.fn(async (text: string) => `[要約ログ] ${text}`),
  structureDailyReflectionLocally: vi.fn(async (text: string) => `[振り返り構造化] ${text}`),
}));

describe("POST /api/journal/local-summarize", () => {
  it("textが空なら400を返す", async () => {
    const req = new Request("http://localhost/api/journal/local-summarize", {
      method: "POST",
      body: JSON.stringify({ text: "  " }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("mode=logで要約を返す", async () => {
    const req = new Request("http://localhost/api/journal/local-summarize", {
      method: "POST",
      body: JSON.stringify({ text: "議事録テキスト", mode: "log" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBe("[要約ログ] 議事録テキスト");
  });

  it("mode=reflectionで振り返り構造化を返す", async () => {
    const req = new Request("http://localhost/api/journal/local-summarize", {
      method: "POST",
      body: JSON.stringify({ text: "今日の振り返り", mode: "reflection" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBe("[振り返り構造化] 今日の振り返り");
  });
});

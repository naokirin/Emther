import { Hono } from "hono";
import type { JournalLocalSummarizeResponse } from "@emther/api-contract";
import {
  generateNextReflectionQuestionLocally,
  structureDailyReflectionLocally,
  summarizeLogLocally,
  type ReflectionTurn,
} from "@emther/core/local-summarizer";

export const journalLocalSummarizeRoute = new Hono().post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const mode = body?.mode ?? "log";

  if (mode === "question") {
    // 問いかけはチャット履歴のみを材料にする（Journal を混ぜると文脈混同しやすい）
    const history: ReflectionTurn[] = Array.isArray(body?.history) ? body.history : [];
    try {
      const question = await generateNextReflectionQuestionLocally(history);
      const resBody = { question } satisfies JournalLocalSummarizeResponse;
      return c.json(resBody);
    } catch (err) {
      return c.json({ error: (err as Error).message ?? "問いかけの生成に失敗しました" }, 500);
    }
  }

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return c.json({ error: "textは必須です" }, 400);
  }

  try {
    const summary = mode === "reflection" ? await structureDailyReflectionLocally(text) : await summarizeLogLocally(text);
    const resBody = { summary } satisfies JournalLocalSummarizeResponse;
    return c.json(resBody);
  } catch (err) {
    return c.json({ error: (err as Error).message ?? "ローカル要約に失敗しました" }, 500);
  }
});

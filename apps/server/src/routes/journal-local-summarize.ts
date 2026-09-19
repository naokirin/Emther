import { Hono } from "hono";
import {
  generateNextReflectionQuestionLocally,
  structureDailyReflectionLocally,
  summarizeLogLocally,
  type ReflectionTurn,
} from "@emther/core/local-summarizer";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ7）: web/src/app/api/journal/local-summarize/route.ts の移植。
export const journalLocalSummarizeRoute = new Hono().post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const mode = body?.mode ?? "log";

  if (mode === "question") {
    const history: ReflectionTurn[] = Array.isArray(body?.history) ? body.history : [];
    const todayJournals: string[] = Array.isArray(body?.todayJournals) ? body.todayJournals : [];
    try {
      const question = await generateNextReflectionQuestionLocally(history, todayJournals);
      return c.json({ question });
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
    return c.json({ summary });
  } catch (err) {
    return c.json({ error: (err as Error).message ?? "ローカル要約に失敗しました" }, 500);
  }
});

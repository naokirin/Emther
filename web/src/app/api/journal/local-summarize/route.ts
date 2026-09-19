import { NextResponse } from "next/server";
import {
  summarizeLogLocally,
  structureDailyReflectionLocally,
  generateNextReflectionQuestionLocally,
  type ReflectionTurn,
} from "@core/local-summarizer";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const mode = body?.mode ?? "log";

  if (mode === "question") {
    const history: ReflectionTurn[] = Array.isArray(body?.history) ? body.history : [];
    const todayJournals: string[] = Array.isArray(body?.todayJournals) ? body.todayJournals : [];
    try {
      const question = await generateNextReflectionQuestionLocally(history, todayJournals);
      return NextResponse.json({ question });
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message ?? "問いかけの生成に失敗しました" },
        { status: 500 },
      );
    }
  }

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }

  try {
    const summary =
      mode === "reflection"
        ? await structureDailyReflectionLocally(text)
        : await summarizeLogLocally(text);

    return NextResponse.json({ summary });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "ローカル要約に失敗しました" },
      { status: 500 },
    );
  }
}

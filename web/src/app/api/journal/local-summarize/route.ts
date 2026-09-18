import { NextResponse } from "next/server";
import { summarizeLogLocally, structureDailyReflectionLocally } from "@/lib/local-summarizer";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const mode = body?.mode === "reflection" ? "reflection" : "log";

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

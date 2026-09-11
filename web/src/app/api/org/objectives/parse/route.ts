import { NextResponse } from "next/server";
import { parseOkrText } from "@/lib/okr-parse";

// docs/usage_issues U18: OKR全文を構造化してプレビュー用ドラフトを返す（保存はしない）。
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }
  const result = await parseOkrText(text);
  return NextResponse.json(result);
}

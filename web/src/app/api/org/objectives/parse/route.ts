import { NextResponse } from "next/server";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";
import { parseOkrText } from "@/lib/okr-parse";

// docs/usage_issues U18: OKR全文を構造化してプレビュー用ドラフトを返す（保存はしない）。
// 外部AI（SettingsのCLI優先順）で分解し、失敗時はヒューリスティックへフォールバックする。
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }
  try {
    const result = await parseOkrText(text, maskOptionsFromBody(body));
    return NextResponse.json(result);
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

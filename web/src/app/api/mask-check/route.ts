import { NextResponse } from "next/server";
import { runMaskCheckAi, runMaskCheckQuick, MASK_CHECK_MAX_INPUT_CHARS } from "@/lib/mask-check";

type Phase = "quick" | "ai";

/**
 * 個人・機密情報チェック。
 * body: { text: string, phase?: "quick" | "ai" }
 * - quick: 登録済み人名マスク + ルール検知（即時）
 * - ai: ローカル AI の機微候補 + 未登録人名っぽい語句（常時実行想定・やや遅い）
 * いずれも永続化・人名登録・外部送信なし。
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSONボディが必要です" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
  }

  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string") {
    return NextResponse.json({ error: "text（文字列）が必要です" }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "テキストが空です" }, { status: 400 });
  }
  if (text.length > MASK_CHECK_MAX_INPUT_CHARS * 2) {
    // 極端な巨体は拒否（通常は上限で切り詰めて処理）
    return NextResponse.json(
      { error: `テキストが長すぎます（最大おおよそ ${MASK_CHECK_MAX_INPUT_CHARS} 文字）` },
      { status: 400 },
    );
  }

  const phaseRaw = (body as { phase?: unknown }).phase;
  const phase: Phase = phaseRaw === "ai" ? "ai" : "quick";

  if (phase === "quick") {
    return NextResponse.json({ phase: "quick", ...(await runMaskCheckQuick(text)) });
  }

  const ai = await runMaskCheckAi(text);
  return NextResponse.json({ phase: "ai", ...ai });
}

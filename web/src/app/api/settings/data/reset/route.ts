import { NextResponse } from "next/server";
import { resetAllState, scheduleProcessExit } from "@/lib/state-archive";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (body?.confirm !== "RESET") {
      return NextResponse.json(
        { error: '確認のため body に { "confirm": "RESET" } が必要です' },
        { status: 400 },
      );
    }

    resetAllState();
    scheduleProcessExit();
    return NextResponse.json({ ok: true, requiresRestart: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "リセットに失敗しました" },
      { status: 500 },
    );
  }
}

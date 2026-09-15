import { NextResponse } from "next/server";
import { startJournalBatchAnalysis, toRunView } from "@/lib/agent-runtime";
import { isUnconfirmedNameCandidatesError } from "@/lib/name-candidate-confirmation";

// ユーザー要望「現場メモ（Journal）ページから、集約解釈を手動実行できるボタンを置きたい」
// 対応。/api/themes/distillと同型のオンデマンド起動。
export async function POST() {
  try {
    const run = await startJournalBatchAnalysis({ manual: true });
    if (!run) {
      return NextResponse.json({ pendingUnmasked: true }, { status: 202 });
    }
    return NextResponse.json({ run: toRunView(run) }, { status: 201 });
  } catch (err) {
    if (isUnconfirmedNameCandidatesError(err)) {
      return NextResponse.json({ error: err.message, candidates: err.candidates }, { status: 409 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

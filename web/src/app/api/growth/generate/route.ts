import { NextResponse } from "next/server";
import { startGrowAnalysis, toRunView } from "@/lib/agent-runtime";
import { isUnconfirmedNameCandidatesError } from "@/lib/name-candidate-confirmation";

// docs/2nd_pivot_version.md Phase 8。/api/themes/distillと同型のオンデマンド起動。
export async function POST() {
  try {
    const run = await startGrowAnalysis({ manual: true });
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

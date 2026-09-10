import { NextResponse } from "next/server";
import { startDistillationAnalysis, toRunView } from "@/lib/agent-runtime";
import { isUnconfirmedNameCandidatesError } from "@/lib/name-candidate-confirmation";

export async function POST() {
  try {
    const run = await startDistillationAnalysis({ manual: true });
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

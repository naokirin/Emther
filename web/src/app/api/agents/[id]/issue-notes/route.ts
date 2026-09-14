import { NextResponse } from "next/server";
import { adoptSuggestedIssueNotesFromRun, clearSuggestedIssueNotes, getRun, toRunView } from "@/lib/agent-runtime";

type Ctx = { params: Promise<{ id: string }> };

// docs/memo.md「Agentが相談などから他Issueなどへ記録することができない」対応。
// POST=採用（対象Issueへの追記を確定）、DELETE=却下。いずれも提案自体はrunから消す。
export async function POST(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const result = await adoptSuggestedIssueNotesFromRun(id);
  if (!result) return NextResponse.json({ error: "採用できるIssueへの追記提案がありません" }, { status: 400 });
  return NextResponse.json({
    run: toRunView(result.run),
    written: result.written,
    skipped: result.skipped,
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const run = clearSuggestedIssueNotes(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run: toRunView(run) });
}

import { NextResponse } from "next/server";
import { adoptSuggestedIssueNotesFromRun, clearSuggestedIssueNotes, getRun, toRunView } from "@core/agent-runtime/index";

type Ctx = { params: Promise<{ id: string }> };

function parseIndices(body: unknown): number[] | undefined {
  const raw = (body as { indices?: unknown } | null)?.indices;
  if (!Array.isArray(raw)) return undefined;
  const indices = raw.filter((n): n is number => typeof n === "number");
  return indices.length > 0 ? indices : undefined;
}

// docs/memo.md「Agentが相談などから他Issueなどへ記録することができない」「他Issueへの追記提案で
// 追記対象を個別に選択できるようにする」対応。POST=採用（対象Issueへの追記を確定）、DELETE=却下/
// 対応済み。bodyでindicesを指定するとsuggestedIssueNotes中の該当要素のみを対象にし、未指定時は
// 従来どおり全件を対象にする。いずれも処理した提案はrunから消す。
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const indices = parseIndices(body);
  const result = await adoptSuggestedIssueNotesFromRun(id, indices);
  if (!result) return NextResponse.json({ error: "採用できる追記提案がありません" }, { status: 400 });
  return NextResponse.json({
    run: toRunView(result.run),
    written: result.written,
    skipped: result.skipped,
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const indices = parseIndices(body);
  const reason = (body as { reason?: unknown } | null)?.reason === "handled" ? "handled" : "dismissed";
  const run = clearSuggestedIssueNotes(id, { indices, reason });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run: toRunView(run) });
}

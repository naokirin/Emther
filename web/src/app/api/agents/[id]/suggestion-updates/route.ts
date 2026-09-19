import { NextResponse } from "next/server";
import { adoptSuggestionUpdatesFromRun, clearSuggestedSuggestionUpdates, getRun, toRunView } from "@core/agent-runtime/index";

type Ctx = { params: Promise<{ id: string }> };

function parseIndices(body: unknown): number[] | undefined {
  const raw = (body as { indices?: unknown } | null)?.indices;
  if (!Array.isArray(raw)) return undefined;
  const indices = raw.filter((n): n is number => typeof n === "number");
  return indices.length > 0 ? indices : undefined;
}

// docs/suggestion_organize_via_consult.md「5. 反映の契約（HITL）」対応。POST=まとめて反映
// （suggestedSuggestionUpdatesの対象要素を実際のSuggestionへ書き込む）、DELETE=却下。
// bodyでindicesを指定すると該当要素のみを対象にし、未指定時は従来どおり全件を対象にする。
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const indices = parseIndices(body);
  const result = await adoptSuggestionUpdatesFromRun(id, indices);
  if (!result) return NextResponse.json({ error: "反映できる整理差分がありません" }, { status: 400 });
  return NextResponse.json({
    run: toRunView(result.run),
    applied: result.applied,
    skipped: result.skipped,
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const indices = parseIndices(body);
  const run = clearSuggestedSuggestionUpdates(id, { indices });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run: toRunView(run) });
}

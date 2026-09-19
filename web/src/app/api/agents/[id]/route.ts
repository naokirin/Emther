import { NextResponse } from "next/server";
import { getRun, listRuns, toRunView } from "@core/agent-runtime/index";
import { resolveUniqueByPrefix } from "@core/id-resolve";

export async function GET(_request: Request, ctx: RouteContext<"/api/agents/[id]">) {
  const { id } = await ctx.params;
  const exact = getRun(id);
  if (exact) {
    return NextResponse.json({ run: toRunView(exact) });
  }
  const resolved = resolveUniqueByPrefix(listRuns(), (r) => r.id, id);
  if (resolved.status === "none") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (resolved.status === "ambiguous") {
    return NextResponse.json(
      {
        error: "ambiguous",
        candidates: resolved.items.map((r) => ({
          id: r.id,
          label: `${r.agentName}: ${r.task.slice(0, 80)}`,
          href: `/chat?runId=${encodeURIComponent(r.id)}`,
        })),
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ run: toRunView(resolved.item) });
}

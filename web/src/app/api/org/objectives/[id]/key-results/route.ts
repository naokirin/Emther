import { NextResponse } from "next/server";
import { addKeyResult, toObjectiveView } from "@/lib/org-context-store";

export async function POST(request: Request, ctx: RouteContext<"/api/org/objectives/[id]/key-results">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "titleは必須です" }, { status: 400 });
  }
  const objective = await addKeyResult(id, title);
  if (!objective) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ objective: toObjectiveView(objective) }, { status: 201 });
}

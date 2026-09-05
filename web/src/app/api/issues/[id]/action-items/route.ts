import { NextResponse } from "next/server";
import { addActionItem } from "@/lib/issue-store";

export async function POST(request: Request, ctx: RouteContext<"/api/issues/[id]/action-items">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }

  const issue = addActionItem(id, text);
  if (!issue) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ issue }, { status: 201 });
}

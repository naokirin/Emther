import { NextResponse } from "next/server";
import { addActionItem, toIssueView } from "@/lib/issue-store";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";

export async function POST(request: Request, ctx: RouteContext<"/api/issues/[id]/action-items">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }

  try {
    const issue = await addActionItem(id, text, {
      ...maskOptionsFromBody(body),
    });
    if (!issue) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ issue: toIssueView(issue) }, { status: 201 });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

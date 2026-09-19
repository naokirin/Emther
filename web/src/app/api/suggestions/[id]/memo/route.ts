import { NextResponse } from "next/server";
import { addMemo, getSuggestion, toSuggestionView } from "@core/suggestion-store";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";
import { reactToIssueUpdate } from "@core/agent-runtime/index";
import { resolveUniqueByPrefix } from "@/lib/id-resolve";
import { listSuggestions } from "@core/suggestion-store";

export async function POST(request: Request, ctx: RouteContext<"/api/suggestions/[id]/memo">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }

  const exact = getSuggestion(id);
  const resolved = exact
    ? ({ status: "exact" as const, item: exact } as const)
    : resolveUniqueByPrefix(listSuggestions(), (s) => s.id, id);
  if (resolved.status !== "exact" && resolved.status !== "unique") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const suggestion = await addMemo(resolved.item.id, text, {
      ...maskOptionsFromBody(body),
      onUpdated: (sid, _trigger, detail) => reactToIssueUpdate(sid, "log", detail),
    });
    if (!suggestion) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ suggestion: toSuggestionView(suggestion) }, { status: 201 });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

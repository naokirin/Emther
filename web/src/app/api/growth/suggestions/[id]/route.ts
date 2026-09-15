import { NextResponse } from "next/server";
import {
  GROW_SUGGESTION_STATUSES,
  setGrowSuggestionStatus,
  toGrowSuggestionView,
  type GrowSuggestionStatus,
} from "@/lib/em-growth-store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/growth/suggestions/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (typeof status !== "string" || !GROW_SUGGESTION_STATUSES.includes(status as GrowSuggestionStatus)) {
    return NextResponse.json(
      { error: "statusはunread/acknowledged/dismissedのいずれかである必要があります" },
      { status: 400 },
    );
  }
  const updated = setGrowSuggestionStatus(id, status as GrowSuggestionStatus);
  if (!updated) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ suggestion: toGrowSuggestionView(updated) });
}

import { NextResponse } from "next/server";
import {
  listSuggestions,
  moveFocusSuggestion,
  setConfirmPriority,
  setReviewStatus,
  setSuggestionKeyResult,
  setSuggestionTeam,
  setSuggestionTheme,
  setSuggestionTitle,
  toSuggestionView,
  getSuggestion,
} from "@/lib/suggestion-store";
import { CONFIRM_PRIORITIES, SUGGESTION_REVIEW_STATUSES, type ConfirmPriority, type SuggestionReviewStatus } from "@/lib/types";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";
import { listSourceJournalsForIssue, toJournalEntryViews } from "@/lib/journal-store";
import { buildSourceConsultIndex } from "@/lib/journal-consult-index";
import { resolveUniqueByPrefix } from "@/lib/id-resolve";

function resolveSuggestionForRead(id: string) {
  return resolveUniqueByPrefix(listSuggestions(), (s) => s.id, id);
}

function resolveSuggestionId(id: string): string | undefined {
  const exact = getSuggestion(id);
  if (exact) return exact.id;
  const resolved = resolveSuggestionForRead(id);
  if (resolved.status === "exact" || resolved.status === "unique") return resolved.item.id;
  return undefined;
}

export async function GET(_request: Request, ctx: RouteContext<"/api/suggestions/[id]">) {
  const { id } = await ctx.params;
  const resolved = resolveSuggestionForRead(id);
  if (resolved.status === "none") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (resolved.status === "ambiguous") {
    return NextResponse.json(
      {
        error: "ambiguous",
        candidates: resolved.items.map((s) => ({ id: s.id, title: s.title, href: `/suggestions/${s.id}` })),
      },
      { status: 409 },
    );
  }
  const suggestion = resolved.item;
  return NextResponse.json({
    suggestion: toSuggestionView(suggestion),
    sourceJournals: toJournalEntryViews(
      listSourceJournalsForIssue(suggestion.id, suggestion.sourceJournalId),
      await buildSourceConsultIndex(),
    ),
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/suggestions/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const opts = maskOptionsFromBody(body);

  if (typeof body?.title === "string" && !body.title.trim()) {
    return NextResponse.json({ error: "titleは必須です" }, { status: 400 });
  }
  if ("reviewStatus" in (body ?? {}) && !SUGGESTION_REVIEW_STATUSES.includes(body.reviewStatus)) {
    return NextResponse.json({ error: "reviewStatusの値が不正です" }, { status: 400 });
  }
  if ("confirmPriority" in (body ?? {}) && !CONFIRM_PRIORITIES.includes(body.confirmPriority)) {
    return NextResponse.json({ error: "confirmPriorityの値が不正です" }, { status: 400 });
  }
  if ("moveFocus" in (body ?? {}) && body.moveFocus !== "up" && body.moveFocus !== "down") {
    return NextResponse.json({ error: "moveFocusは up または down です" }, { status: 400 });
  }

  const suggestionId = resolveSuggestionId(id);
  if (!suggestionId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    let suggestion = getSuggestion(suggestionId)!;

    if (typeof body?.title === "string" && body.title.trim()) {
      suggestion = (await setSuggestionTitle(suggestionId, body.title, opts)) ?? suggestion;
    }
    if ("reviewStatus" in (body ?? {})) {
      suggestion = setReviewStatus(suggestionId, body.reviewStatus as SuggestionReviewStatus) ?? suggestion;
    }
    if ("confirmPriority" in (body ?? {})) {
      suggestion = setConfirmPriority(suggestionId, body.confirmPriority as ConfirmPriority) ?? suggestion;
    }
    if (body?.moveFocus === "up" || body?.moveFocus === "down") {
      suggestion = moveFocusSuggestion(suggestionId, body.moveFocus) ?? suggestion;
    }
    if ("keyResultId" in (body ?? {})) {
      const keyResultId = typeof body.keyResultId === "string" && body.keyResultId ? body.keyResultId : null;
      suggestion = setSuggestionKeyResult(suggestionId, keyResultId) ?? suggestion;
    }
    if ("themeId" in (body ?? {})) {
      const themeId = typeof body.themeId === "string" && body.themeId ? body.themeId : null;
      suggestion = setSuggestionTheme(suggestionId, themeId) ?? suggestion;
    }
    if ("teamId" in (body ?? {})) {
      const teamId = typeof body.teamId === "string" && body.teamId ? body.teamId : null;
      suggestion = setSuggestionTeam(suggestionId, teamId) ?? suggestion;
    }

    return NextResponse.json({ suggestion: toSuggestionView(suggestion) });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

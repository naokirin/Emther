import { NextResponse } from "next/server";
import {
  archiveSuggestion,
  listSuggestions,
  moveFocusSuggestion,
  setConfirmPriority,
  setReviewStatus,
  setSuggestionDetail,
  setSuggestionKeyResult,
  setSuggestionReviewDueAt,
  setSuggestionTeam,
  setSuggestionTheme,
  setSuggestionTitle,
  toSuggestionView,
  unarchiveSuggestion,
  updateSuggestionDetail,
  getSuggestion,
} from "@core/suggestion-store";
import { CONFIRM_PRIORITIES, SUGGESTION_REVIEW_STATUSES, type ConfirmPriority, type SuggestionReviewStatus } from "@core/types";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";
import { listSourceJournalsForIssue, toJournalEntryViews } from "@core/journal-store";
import { buildSourceConsultIndex } from "@/lib/journal-consult-index";
import { resolveUniqueByPrefix } from "@/lib/id-resolve";
import { getRun, reactToIssueUpdate } from "@core/agent-runtime/index";

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
  if ("archived" in (body ?? {}) && typeof body.archived !== "boolean") {
    return NextResponse.json({ error: "archivedはtrue/falseです" }, { status: 400 });
  }
  if ("reviewDueAt" in (body ?? {}) && body.reviewDueAt !== null && typeof body.reviewDueAt !== "number") {
    return NextResponse.json({ error: "reviewDueAtは数値（タイムスタンプ）またはnullです" }, { status: 400 });
  }
  // ユーザー要望「提案の詳細をユーザーでも編集したい」対応。
  if ("detail" in (body ?? {})) {
    const d = body.detail;
    if (!d || typeof d !== "object") {
      return NextResponse.json({ error: "detailはオブジェクトです" }, { status: 400 });
    }
    if ("conclusion" in d && typeof d.conclusion !== "string") {
      return NextResponse.json({ error: "detail.conclusionは文字列です" }, { status: 400 });
    }
    if ("logic" in d && typeof d.logic !== "string") {
      return NextResponse.json({ error: "detail.logicは文字列です" }, { status: 400 });
    }
    if ("facts" in d && (!Array.isArray(d.facts) || !d.facts.every((f: unknown) => typeof f === "string"))) {
      return NextResponse.json({ error: "detail.factsは文字列の配列です" }, { status: 400 });
    }
    if ("advice" in d && typeof d.advice !== "string") {
      return NextResponse.json({ error: "detail.adviceは文字列です" }, { status: 400 });
    }
  }

  const suggestionId = resolveSuggestionId(id);
  if (!suggestionId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    let suggestion = getSuggestion(suggestionId)!;

    if (typeof body?.title === "string" && body.title.trim()) {
      suggestion = (await setSuggestionTitle(suggestionId, body.title, {
        ...opts,
        onUpdated: (sid, _trigger, detail) => reactToIssueUpdate(sid, "charter", detail),
      })) ?? suggestion;
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
    if ("archived" in (body ?? {})) {
      suggestion = (body.archived ? archiveSuggestion(suggestionId) : unarchiveSuggestion(suggestionId)) ?? suggestion;
    }
    if ("reviewDueAt" in (body ?? {})) {
      suggestion = setSuggestionReviewDueAt(suggestionId, typeof body.reviewDueAt === "number" ? body.reviewDueAt : null) ?? suggestion;
    }
    // ユーザー要望「提案の詳細をユーザーでも編集したい」対応。AI由来のsetSuggestionDetailと
    // 違い、EMの自由記述なのでensureNameCandidatesAllowed／maskForStorageを通す
    // （updateSuggestionDetail内部で実施）。未指定のフィールドは現在値を保持する部分更新。
    if ("detail" in (body ?? {})) {
      const d = body.detail as { conclusion?: string; facts?: string[]; logic?: string; advice?: string };
      suggestion =
        (await updateSuggestionDetail(
          suggestionId,
          {
            ...(d.conclusion !== undefined ? { conclusion: d.conclusion } : {}),
            ...(d.facts !== undefined ? { facts: d.facts } : {}),
            ...(d.logic !== undefined ? { logic: d.logic } : {}),
            ...(d.advice !== undefined ? { advice: d.advice } : {}),
          },
          opts,
        )) ?? suggestion;
    }
    // docs/memo.md「メモとは別に提案自体の詳細を残す単一の場所」対応。壁打ちの継続等で
    // 判断・提案（Agent）の内容が起票時から変わった場合に、EMが明示して詳細を更新し直す。
    if (typeof body?.refreshDetailFromRunId === "string" && body.refreshDetailFromRunId.trim()) {
      const run = getRun(body.refreshDetailFromRunId.trim());
      if (!run || !run.proposal) {
        return NextResponse.json({ error: "指定されたAgent Runに判断・提案がありません" }, { status: 400 });
      }
      suggestion =
        setSuggestionDetail(suggestionId, {
          conclusion: run.proposal.conclusion,
          facts: run.proposal.facts,
          logic: run.proposal.logic,
          ...(run.proposal.expansions?.length ? { expansions: run.proposal.expansions } : {}),
          ...(run.proposal.challenges?.length ? { challenges: run.proposal.challenges } : {}),
          ...(run.proposal.advice ? { advice: run.proposal.advice } : {}),
        }) ?? suggestion;
    }

    return NextResponse.json({ suggestion: toSuggestionView(suggestion) });
  } catch (err) {
    // updateSuggestionDetailの「結論と判断ロジックは必須です」等、入力起因のエラーは
    // 4xxとして返す（jsonFromUnknownErrorはUnconfirmedNameCandidatesErrorなら409、
    // それ以外はここで渡すfallbackStatusを使う）。
    return jsonFromUnknownError(err, 400);
  }
}

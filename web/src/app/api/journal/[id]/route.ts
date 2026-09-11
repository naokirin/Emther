import { NextResponse } from "next/server";
import { getCurrentJournalEntry, listJournalEntries, toJournalEntryView, updateJournalEntry } from "@/lib/journal-store";
import { dateStringToNoonTimestamp } from "@/lib/journal-date-parser";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";
import { resolveUniqueByPrefix } from "@/lib/id-resolve";

export async function GET(_request: Request, ctx: RouteContext<"/api/journal/[id]">) {
  const { id } = await ctx.params;
  const exact = getCurrentJournalEntry(id);
  if (exact) {
    return NextResponse.json({ entry: toJournalEntryView(exact) });
  }
  const resolved = resolveUniqueByPrefix(listJournalEntries(), (e) => e.id, id);
  if (resolved.status === "none") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (resolved.status === "ambiguous") {
    return NextResponse.json(
      {
        error: "ambiguous",
        candidates: resolved.items.map((e) => ({
          id: e.id,
          label: e.summary || e.rawText.slice(0, 80),
          href: `/journal?focus=${encodeURIComponent(e.id)}`,
        })),
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ entry: toJournalEntryView(resolved.item) });
}

// docs/memo.md「C. Journalセンシング→行動」対応。AI抽出（tags/people/urgency）を
// EMがその場で校正するためのエンドポイント。内部的には新しいイベントをsupersedesで
// 繋いで記録するだけで、元のジャーナルは削除・上書きしない。
export async function PATCH(request: Request, ctx: RouteContext<"/api/journal/[id]">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);

  // docs/em_human_story_and_ux.md 改修依頼「まとめ入力・通常投入どちらでも日付レベルの
  // 訂正を扱えるように」対応。occurredAtDateは"YYYY-MM-DD"（日付レベルのみ）。
  let occurredAt: number | undefined;
  if (typeof body?.occurredAtDate === "string" && body.occurredAtDate) {
    occurredAt = dateStringToNoonTimestamp(body.occurredAtDate);
    if (occurredAt === undefined) {
      return NextResponse.json({ error: "occurredAtDateの形式が不正です（YYYY-MM-DD）" }, { status: 400 });
    }
  }

  // docs/em_human_story_and_ux.md 改修依頼「Journalの本文を編集できるようにする」対応。
  // 記録時の言い間違い等の訂正用。空文字での更新はPOST同様に拒否する。
  if (typeof body?.rawText === "string" && !body.rawText.trim()) {
    return NextResponse.json({ error: "rawTextは空にできません" }, { status: 400 });
  }

  // docs/em_human_story_and_ux.md 改修依頼「Journalをurgency:highのまま解決済みにできない」
  // 対応。未指定（キー自体が無い）=変更しない、null=解除、文字列=設定、の3値。
  const resolvedIssueId =
    body?.resolvedIssueId === undefined
      ? undefined
      : body.resolvedIssueId === null
        ? null
        : typeof body.resolvedIssueId === "string"
          ? body.resolvedIssueId
          : undefined;
  const resolutionNote =
    body?.resolutionNote === undefined
      ? undefined
      : body.resolutionNote === null
        ? null
        : typeof body.resolutionNote === "string"
          ? body.resolutionNote
          : undefined;

  try {
    const entry = await updateJournalEntry(
      id,
      {
        rawText: typeof body?.rawText === "string" && body.rawText.trim() ? body.rawText : undefined,
        tags: Array.isArray(body?.tags) ? body.tags.filter((t: unknown): t is string => typeof t === "string") : undefined,
        people: Array.isArray(body?.people)
          ? body.people.filter((p: unknown): p is string => typeof p === "string")
          : undefined,
        teams: Array.isArray(body?.teams)
          ? body.teams.filter((t: unknown): t is string => typeof t === "string")
          : undefined,
        teamIds: Array.isArray(body?.teamIds)
          ? body.teamIds.filter((t: unknown): t is string => typeof t === "string")
          : undefined,
        urgency: body?.urgency === "low" || body?.urgency === "mid" || body?.urgency === "high" ? body.urgency : undefined,
        occurredAt,
        resolvedIssueId,
        resolutionNote,
      },
      maskOptionsFromBody(body),
    );
    if (!entry) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ entry: toJournalEntryView(entry) });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

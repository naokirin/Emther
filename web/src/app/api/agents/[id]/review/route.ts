import { NextResponse } from "next/server";
import { markRunReviewed, setRunArchived, setRunTriageStatus, toRunView } from "@core/agent-runtime/index";

// docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。archivedはtriageStatus
// （様子見/却下）とは独立の軸のため、他の指定と併用できるよう独立して処理する。
export async function POST(request: Request, ctx: RouteContext<"/api/agents/[id]/review">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  if ("archived" in (body ?? {}) && typeof body.archived !== "boolean") {
    return NextResponse.json({ error: "archivedはtrue/falseです" }, { status: 400 });
  }

  const triageStatus = body?.triageStatus === "watching" || body?.triageStatus === "dismissed" ? body.triageStatus : undefined;
  const hasArchived = "archived" in (body ?? {});

  let run = triageStatus ? setRunTriageStatus(id, triageStatus) : undefined;
  if (hasArchived) run = setRunArchived(id, body.archived) ?? run;
  if (!triageStatus && !hasArchived) run = markRunReviewed(id);

  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ run: toRunView(run) });
}

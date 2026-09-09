import { NextResponse } from "next/server";
import { addLogEntry, toIssueView } from "@/lib/issue-store";
import { jsonFromUnknownError, parseAllowUnmaskedCandidates } from "@/app/api/name-candidate-response";

// ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
export async function POST(request: Request, ctx: RouteContext<"/api/issues/[id]/log">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }

  try {
    const issue = await addLogEntry(id, text, {
      allowUnmaskedCandidates: parseAllowUnmaskedCandidates(body),
    });
    if (!issue) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ issue: toIssueView(issue) }, { status: 201 });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

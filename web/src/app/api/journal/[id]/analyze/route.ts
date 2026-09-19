import { NextResponse } from "next/server";
import { getCurrentJournalEntry, toJournalEntryView } from "@core/journal-store";
import { requestJournalAnalysis } from "@core/journal-analysis";
import { toRunView } from "@core/agent-runtime/index";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";

// docs/usage_issues U16。EMが明示した手動分析。投稿時・自動フィルタとは独立に起動する。
export async function POST(request: Request, ctx: RouteContext<"/api/journal/[id]/analyze">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);

  const current = getCurrentJournalEntry(id);
  if (!current) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!current.confirmed) {
    return NextResponse.json(
      { error: "未確認のJournalは分析できません。先に内容を確定してください。" },
      { status: 400 },
    );
  }

  try {
    const result = await requestJournalAnalysis(id, maskOptionsFromBody(body));
    if (!result) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(
      {
        entry: {
          ...toJournalEntryView(result.entry, new Map()),
          sourceConsultRunId: result.run.id,
        },
        run: toRunView(result.run),
      },
      { status: 201 },
    );
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

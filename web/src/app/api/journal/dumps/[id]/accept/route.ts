import { NextResponse } from "next/server";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";
import { acceptDumpChunks } from "@/lib/observation-dump-actions";
import { getObservationDump, toObservationDumpView } from "@/lib/observation-dump-store";
import { toJournalEntryViews } from "@/lib/journal-store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getObservationDump(id)) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const chunkIds = Array.isArray(body?.chunkIds)
    ? body.chunkIds.filter((x: unknown): x is string => typeof x === "string")
    : [];

  try {
    const { dump, entries } = await acceptDumpChunks(id, chunkIds, maskOptionsFromBody(body));
    return NextResponse.json(
      { dump: toObservationDumpView(dump), entries: toJournalEntryViews(entries) },
      { status: 201 },
    );
  } catch (err) {
    const message = (err as Error).message;
    if (
      message.includes("選んでください") ||
      message.includes("採用可能") ||
      message.includes("破棄済み") ||
      message.includes("分割処理中")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return jsonFromUnknownError(err);
  }
}

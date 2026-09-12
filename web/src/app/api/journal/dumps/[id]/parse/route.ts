import { NextResponse } from "next/server";
import { jsonFromUnknownError } from "@/app/api/name-candidate-response";
import { runParseOnDump } from "@/lib/observation-dump-actions";
import { getObservationDump, toObservationDumpView } from "@/lib/observation-dump-store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getObservationDump(id)) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }
  try {
    const dump = await runParseOnDump(id);
    return NextResponse.json({ dump: toObservationDumpView(dump) });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

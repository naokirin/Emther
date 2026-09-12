import { NextResponse } from "next/server";
import { jsonFromUnknownError } from "@/app/api/name-candidate-response";
import { maskForStorage } from "@/lib/people-directory";
import {
  discardObservationDump,
  getObservationDump,
  patchChunkDrafts,
  toObservationDumpView,
  type ChunkDisposition,
} from "@/lib/observation-dump-store";

type Ctx = { params: Promise<{ id: string }> };

const DISPOSITIONS: ChunkDisposition[] = ["pending", "accept", "edit", "merge_into", "drop"];

function isDisposition(v: unknown): v is ChunkDisposition {
  return typeof v === "string" && (DISPOSITIONS as string[]).includes(v);
}

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const dump = getObservationDump(id);
  if (!dump) return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  return NextResponse.json({ dump: toObservationDumpView(dump) });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const dump = getObservationDump(id);
  if (!dump) return NextResponse.json({ error: "見つかりません" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (body?.discard === true) {
    const discarded = discardObservationDump(id);
    return NextResponse.json({ dump: toObservationDumpView(discarded!) });
  }

  try {
    const rawPatches = Array.isArray(body?.chunks) ? body.chunks : [];
    const patches: Array<{
      id: string;
      disposition?: ChunkDisposition;
      text?: string;
      suggestedOccurredAt?: string | null;
      dropReason?: string | null;
    }> = [];

    for (const item of rawPatches) {
      if (!item || typeof item.id !== "string") continue;
      const patch: (typeof patches)[number] = { id: item.id };
      if (isDisposition(item.disposition)) patch.disposition = item.disposition;
      if (typeof item.text === "string") {
        patch.text = await maskForStorage(item.text);
      }
      if (item.suggestedOccurredAt === null) patch.suggestedOccurredAt = null;
      else if (typeof item.suggestedOccurredAt === "string") {
        patch.suggestedOccurredAt = item.suggestedOccurredAt;
      }
      if (item.dropReason === null) patch.dropReason = null;
      else if (typeof item.dropReason === "string") {
        patch.dropReason = await maskForStorage(item.dropReason);
      }
      patches.push(patch);
    }

    const updated = patches.length > 0 ? patchChunkDrafts(id, patches) : dump;
    if (!updated) return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
    return NextResponse.json({ dump: toObservationDumpView(updated) });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

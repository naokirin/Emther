import { NextResponse } from "next/server";
import { deleteGlossaryEntry, getGlossaryEntry, updateGlossaryEntry } from "@/lib/glossary-store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const entry = getGlossaryEntry(id);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const updated = updateGlossaryEntry(id, {
    term: typeof body?.term === "string" ? body.term : undefined,
    reading: typeof body?.reading === "string" ? body.reading : undefined,
    meaning: typeof body?.meaning === "string" ? body.meaning : undefined,
    category: typeof body?.category === "string" ? body.category : undefined,
  });

  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ entry: updated });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const success = deleteGlossaryEntry(id);
  if (!success) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

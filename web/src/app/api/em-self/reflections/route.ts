import { NextResponse } from "next/server";
import { addReflection, listReflections, toReflectionView } from "@/lib/em-self-store";

export async function GET() {
  return NextResponse.json({ reflections: listReflections().map(toReflectionView) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const periodStart = Number(body?.periodStart);
  const periodEnd = Number(body?.periodEnd);
  if (!Number.isFinite(periodStart) || !Number.isFinite(periodEnd)) {
    return NextResponse.json({ error: "periodStart/periodEndは数値である必要があります" }, { status: 400 });
  }
  const keep = typeof body?.keep === "string" ? body.keep : "";
  const problem = typeof body?.problem === "string" ? body.problem : "";
  const tryNext = typeof body?.tryNext === "string" ? body.tryNext : "";
  if (!keep.trim() && !problem.trim() && !tryNext.trim()) {
    return NextResponse.json({ error: "Keep/Problem/Tryのいずれかは入力してください" }, { status: 400 });
  }
  const reflection = await addReflection({ periodStart, periodEnd, keep, problem, tryNext });
  return NextResponse.json({ reflection: toReflectionView(reflection) }, { status: 201 });
}

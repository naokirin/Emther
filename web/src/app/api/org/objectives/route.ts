import { NextResponse } from "next/server";
import { addObjective, listObjectivesWithProgress, toObjectiveView } from "@/lib/org-context-store";

// docs/memo.md「H. 戦略→Issue→結果の一本線」対応。
export async function GET() {
  return NextResponse.json({ objectives: listObjectivesWithProgress().map(toObjectiveView) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "titleは必須です" }, { status: 400 });
  }
  const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : undefined;
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : undefined;
  const objective = await addObjective(title, teamId, note);
  return NextResponse.json({ objective: toObjectiveView(objective) }, { status: 201 });
}

import { NextResponse } from "next/server";
import { addTeam, listTeams } from "@/lib/org-context-store";
import { teamPathSegments } from "@/lib/types";

export async function GET() {
  return NextResponse.json({ teams: listTeams() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  const members = Array.isArray(body?.members)
    ? body.members.filter((m: unknown): m is string => typeof m === "string")
    : [];

  // "/"のみ・空白のみなど、正規化すると空になる名前は「実質的にnameが無い」として拒否する
  // （階層区切りの"/"だけを入力してしまうミスを防ぐ）。
  if (teamPathSegments(name).length === 0) {
    return NextResponse.json({ error: "nameは必須です" }, { status: 400 });
  }

  const team = addTeam(name, members);
  return NextResponse.json({ team }, { status: 201 });
}

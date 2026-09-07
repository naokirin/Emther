import { NextResponse } from "next/server";
import { addTeam, listTeams, type Team } from "@/lib/org-context-store";
import { teamPathSegments } from "@/lib/types";
import { unmaskNames } from "@/lib/people-directory";

// 個人情報の分離（ユーザー指摘対応）: ストアはmembersをPERSON_n IDで保持する。
// EM向けの応答を組み立てるこの境界でだけ実名へ復元する。
function toView(team: Team): Team {
  return { ...team, members: team.members.map(unmaskNames) };
}

export async function GET() {
  return NextResponse.json({ teams: listTeams().map(toView) });
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
  return NextResponse.json({ team: toView(team) }, { status: 201 });
}

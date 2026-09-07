import { NextResponse } from "next/server";
import { getTeam, setTeamArchived, type Team } from "@/lib/org-context-store";
import { unmaskNames } from "@/lib/people-directory";

function toView(team: Team): Team {
  return { ...team, members: team.members.map(unmaskNames) };
}

export async function POST(request: Request, ctx: RouteContext<"/api/teams/[id]/archive">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const current = getTeam(id);
  if (!current) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const archived = typeof body?.archived === "boolean" ? body.archived : !current.archived;
  const team = setTeamArchived(id, archived);
  return NextResponse.json({ team: team ? toView(team) : team });
}

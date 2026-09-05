import { NextResponse } from "next/server";
import { addTeam, listTeams } from "@/lib/org-context-store";

export async function GET() {
  return NextResponse.json({ teams: listTeams() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const members = Array.isArray(body?.members)
    ? body.members.filter((m: unknown): m is string => typeof m === "string")
    : [];

  if (!name) {
    return NextResponse.json({ error: "nameは必須です" }, { status: 400 });
  }

  const team = addTeam(name, members);
  return NextResponse.json({ team }, { status: 201 });
}

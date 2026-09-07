import { NextResponse } from "next/server";
import { getPersonProfile } from "@/lib/people-hub";

export async function GET(_request: Request, ctx: RouteContext<"/api/people/[id]">) {
  const { id } = await ctx.params;
  const profile = getPersonProfile(id);
  if (!profile) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ person: profile });
}

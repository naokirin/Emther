import { NextResponse } from "next/server";
import { getOrgStrategy, updateOrgStrategy } from "@/lib/org-context-store";

export async function GET() {
  return NextResponse.json({ strategy: getOrgStrategy() });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const strategy = updateOrgStrategy({
    mission: typeof body?.mission === "string" ? body.mission : undefined,
    vision: typeof body?.vision === "string" ? body.vision : undefined,
    values: typeof body?.values === "string" ? body.values : undefined,
    okr: typeof body?.okr === "string" ? body.okr : undefined,
  });
  return NextResponse.json({ strategy });
}

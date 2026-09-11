import { NextResponse } from "next/server";
import {
  addOrgBackground,
  listOrgBackgrounds,
  toOrgBackgroundView,
  type OrgBackgroundScope,
  type OrgBackgroundStatus,
} from "@/lib/org-context-store";

export async function GET() {
  return NextResponse.json({
    backgrounds: listOrgBackgrounds().map(toOrgBackgroundView),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const fact = typeof body?.fact === "string" ? body.fact.trim() : "";
  if (!title || !fact) {
    return NextResponse.json({ error: "titleとfactは必須です" }, { status: 400 });
  }
  const implication = typeof body?.implication === "string" ? body.implication : undefined;
  const occurredOn = typeof body?.occurredOn === "string" ? body.occurredOn : undefined;
  const tags = Array.isArray(body?.tags)
    ? body.tags.filter((t: unknown): t is string => typeof t === "string")
    : undefined;
  const scope: OrgBackgroundScope | undefined =
    body?.scope === "always" || body?.scope === "tagged" ? body.scope : undefined;
  const status: OrgBackgroundStatus | undefined =
    body?.status === "active" || body?.status === "archived" ? body.status : undefined;

  try {
    const entry = await addOrgBackground({
      title,
      fact,
      implication,
      occurredOn,
      tags,
      scope,
      status,
    });
    return NextResponse.json({ background: toOrgBackgroundView(entry) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

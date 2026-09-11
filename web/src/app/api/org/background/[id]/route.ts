import { NextResponse } from "next/server";
import {
  removeOrgBackground,
  toOrgBackgroundView,
  updateOrgBackground,
  type OrgBackgroundScope,
  type OrgBackgroundStatus,
} from "@/lib/org-context-store";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bodyが必要です" }, { status: 400 });
  }

  const patch: {
    title?: string;
    fact?: string;
    implication?: string | null;
    occurredOn?: string | null;
    tags?: string[];
    scope?: OrgBackgroundScope;
    status?: OrgBackgroundStatus;
  } = {};

  if ("title" in body && typeof body.title === "string") patch.title = body.title;
  if ("fact" in body && typeof body.fact === "string") patch.fact = body.fact;
  if ("implication" in body) {
    patch.implication = typeof body.implication === "string" ? body.implication : null;
  }
  if ("occurredOn" in body) {
    patch.occurredOn = typeof body.occurredOn === "string" ? body.occurredOn : null;
  }
  if ("tags" in body) {
    if (!Array.isArray(body.tags)) {
      return NextResponse.json({ error: "tagsは配列である必要があります" }, { status: 400 });
    }
    patch.tags = body.tags.filter((t: unknown): t is string => typeof t === "string");
  }
  if ("scope" in body) {
    if (body.scope !== "always" && body.scope !== "tagged") {
      return NextResponse.json({ error: "scopeは always または tagged です" }, { status: 400 });
    }
    patch.scope = body.scope;
  }
  if ("status" in body) {
    if (body.status !== "active" && body.status !== "archived") {
      return NextResponse.json({ error: "statusは active または archived です" }, { status: 400 });
    }
    patch.status = body.status;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "更新フィールドがありません" }, { status: 400 });
  }

  const entry = await updateOrgBackground(id, patch);
  if (!entry) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ background: toOrgBackgroundView(entry) });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const removed = removeOrgBackground(id);
  if (!removed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

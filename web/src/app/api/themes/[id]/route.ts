import { NextResponse } from "next/server";
import { adoptTheme, dismissTheme, getTheme, reviseTheme, toThemeView } from "@/lib/theme-store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const theme = getTheme(id);
  if (!theme) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ theme: toThemeView(theme) });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "adopt") {
    const theme = await adoptTheme(id);
    if (!theme) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ theme: toThemeView(theme) });
  }
  if (action === "dismiss") {
    const theme = dismissTheme(id);
    if (!theme) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ theme: toThemeView(theme) });
  }
  if (action === "revise") {
    const theme = await reviseTheme(id, {
      title: typeof body?.title === "string" ? body.title : undefined,
      summary: typeof body?.summary === "string" ? body.summary : undefined,
      rationale: typeof body?.rationale === "string" ? body.rationale : undefined,
      facts: Array.isArray(body?.facts) ? body.facts.filter((f: unknown): f is string => typeof f === "string") : undefined,
      rootCause: body?.rootCause === null ? null : typeof body?.rootCause === "string" ? body.rootCause : undefined,
      suggestedDirection:
        body?.suggestedDirection === null
          ? null
          : typeof body?.suggestedDirection === "string"
            ? body.suggestedDirection
            : undefined,
    });
    if (!theme) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ theme: toThemeView(theme) });
  }

  return NextResponse.json({ error: "action は adopt / dismiss / revise のいずれかです" }, { status: 400 });
}

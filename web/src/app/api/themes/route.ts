import { NextResponse } from "next/server";
import { createTheme, listCurrentThemes, toThemeView } from "@core/theme-store";
import type { ThemeStatus } from "@core/theme-store";

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") as ThemeStatus | null;
  const themes = listCurrentThemes(status ? { status } : undefined).map(toThemeView);
  return NextResponse.json({ themes });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
  const rationale = typeof body?.rationale === "string" ? body.rationale.trim() : "";

  if (!title || !summary) {
    return NextResponse.json({ error: "title と summary は必須です" }, { status: 400 });
  }

  const theme = await createTheme({
    title,
    summary,
    rationale: rationale || summary,
    facts: Array.isArray(body?.facts) ? body.facts : [],
    objectiveIds: Array.isArray(body?.objectiveIds) ? body.objectiveIds : [],
    keyResultIds: Array.isArray(body?.keyResultIds) ? body.keyResultIds : [],
    teamId: typeof body?.teamId === "string" ? body.teamId : undefined,
    status: body?.status === "candidate" ? "candidate" : "adopted",
  });

  return NextResponse.json({ theme: toThemeView(theme) }, { status: 201 });
}

import { NextResponse } from "next/server";
import { adoptSuggestedThemesFromRun, clearSuggestedThemes, getRun, toRunView } from "@/lib/agent-runtime";
import { toThemeView } from "@/lib/theme-store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const result = await adoptSuggestedThemesFromRun(id);
  if (!result) return NextResponse.json({ error: "採用できるテーマ提案がありません" }, { status: 400 });
  return NextResponse.json({
    run: toRunView(result.run),
    themes: result.themes.map(toThemeView),
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const run = clearSuggestedThemes(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run: toRunView(run) });
}

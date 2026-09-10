import { NextResponse } from "next/server";
import { listCurrentThemes, toThemeView } from "@/lib/theme-store";
import type { ThemeStatus } from "@/lib/theme-store";

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") as ThemeStatus | null;
  const themes = listCurrentThemes(status ? { status } : undefined).map(toThemeView);
  return NextResponse.json({ themes });
}

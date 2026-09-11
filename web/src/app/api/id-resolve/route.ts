import { NextResponse } from "next/server";
import { isHexIdPrefix } from "@/lib/id-prefix";
import { resolveIdPrefix } from "@/lib/id-resolve";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q || !isHexIdPrefix(q)) {
    return NextResponse.json({ matches: [] as ReturnType<typeof resolveIdPrefix> });
  }
  return NextResponse.json({ matches: resolveIdPrefix(q) });
}

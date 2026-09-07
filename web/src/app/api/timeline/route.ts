import { NextResponse } from "next/server";
import { listTimelineEntries } from "@/lib/timeline";

// docs/memo.md「N. 時系列変化をEMが読む物語に」対応。
export async function GET() {
  return NextResponse.json({ entries: listTimelineEntries() });
}

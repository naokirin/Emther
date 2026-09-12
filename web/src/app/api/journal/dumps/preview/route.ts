import { NextResponse } from "next/server";
import { isImportSyntax } from "@/lib/observation-dump-mapping-types";
import { buildImportPreview } from "@/lib/observation-dump-normalize";
import { listImportProfiles } from "@/lib/observation-dump-profiles";

/** 貼り付けテキストから構文・列・推奨マッピングを返す（保存しない） */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }
  const syntax = isImportSyntax(body?.syntax) ? body.syntax : undefined;
  const hasHeader = typeof body?.hasHeader === "boolean" ? body.hasHeader : undefined;
  const preview = buildImportPreview(text, syntax, hasHeader);
  return NextResponse.json({
    preview,
    profiles: listImportProfiles(),
  });
}

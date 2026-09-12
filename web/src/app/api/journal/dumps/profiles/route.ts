import { NextResponse } from "next/server";
import { parseImportMappingConfig } from "@/lib/observation-dump-mapping-types";
import {
  deleteImportProfile,
  listImportProfiles,
  saveImportProfile,
} from "@/lib/observation-dump-profiles";

export async function GET() {
  return NextResponse.json({ profiles: listImportProfiles() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  const config = parseImportMappingConfig(body?.config ?? body?.mapping);
  if (!name.trim()) {
    return NextResponse.json({ error: "nameは必須です" }, { status: 400 });
  }
  if (!config) {
    return NextResponse.json({ error: "config（mapping）が不正です" }, { status: 400 });
  }
  try {
    const profile = saveImportProfile({
      id: typeof body?.id === "string" ? body.id : undefined,
      name,
      config,
    });
    return NextResponse.json({ profile }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "idは必須です" }, { status: 400 });
  if (!deleteImportProfile(id)) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

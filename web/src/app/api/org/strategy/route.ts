import { NextResponse } from "next/server";
import { getOrgStrategy, type OrgStrategy, updateOrgStrategy } from "@/lib/org-context-store";
import { unmaskNames } from "@/lib/people-directory";

// 個人情報の分離（ユーザー指摘対応）: ストア側はPERSON_n IDでマスクされたテキストを
// 保持している。EM向けの応答を組み立てるこの境界でだけ実名へ復元する。
function toView(strategy: OrgStrategy): OrgStrategy {
  return {
    mission: unmaskNames(strategy.mission),
    vision: unmaskNames(strategy.vision),
    values: unmaskNames(strategy.values),
  };
}

export async function GET() {
  return NextResponse.json({ strategy: toView(getOrgStrategy()) });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const strategy = await updateOrgStrategy({
    mission: typeof body?.mission === "string" ? body.mission : undefined,
    vision: typeof body?.vision === "string" ? body.vision : undefined,
    values: typeof body?.values === "string" ? body.values : undefined,
  });
  return NextResponse.json({ strategy: toView(strategy) });
}

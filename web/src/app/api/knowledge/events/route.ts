import { NextResponse } from "next/server";
import { listEventsForEntity, type KnowledgeEntityType } from "@/lib/knowledge-store";

// docs/memo.md「H: Phase 2」対応。Issue/Teamの変更履歴（KnowledgeEvent）を取得する汎用エンドポイント。
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const entityType = params.get("entityType");
  const entityId = params.get("entityId");

  if ((entityType !== "issue" && entityType !== "team") || !entityId) {
    return NextResponse.json({ error: "entityType(issue|team)とentityIdは必須です" }, { status: 400 });
  }

  const events = listEventsForEntity(entityType as KnowledgeEntityType, entityId);
  return NextResponse.json({ events });
}

import { Hono } from "hono";
import type { KnowledgeEventsResponse } from "@emther/api-contract";
import { listEventsForEntity, toEventView, type KnowledgeEntityType } from "@emther/core/knowledge-store";

// docs/2nd_architecture/plan.md フェーズ2.3: web/src/app/api/knowledge/events/route.ts の移植。
// docs/memo.md「H: Phase 2」対応。Suggestion/Teamの変更履歴（KnowledgeEvent）を取得する汎用エンドポイント。
export const knowledgeEventsRoute = new Hono().get("/", (c) => {
  const entityType = c.req.query("entityType");
  const entityId = c.req.query("entityId");

  if (
    (entityType !== "suggestion" && entityType !== "team" && entityType !== "org") ||
    !entityId
  ) {
    return c.json({ error: "entityType(suggestion|team|org)とentityIdは必須です" }, 400);
  }

  const events = listEventsForEntity(entityType as KnowledgeEntityType, entityId);
  const body = { events: events.map(toEventView) } satisfies KnowledgeEventsResponse;
  return c.json(body);
});

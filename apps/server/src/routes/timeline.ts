import { Hono } from "hono";
import type { TimelineResponse } from "@emther/api-contract/timeline";
import { listTimelineEntries } from "@emther/core/timeline";

// レスポンス形は @emther/api-contract/timeline（Hono RPC の型推論と揃える）
export const timelineRoute = new Hono().get("/", (c) => {
  const body = { entries: listTimelineEntries() } satisfies TimelineResponse;
  return c.json(body);
});

import { Hono } from "hono";
import type { TimelineResponse } from "@emther/api-contract/timeline";
import { listTimelineEntries } from "@emther/core/timeline";

// docs/2nd_architecture/plan.md フェーズ2.3: web/src/app/api/timeline/route.ts の移植。
// docs/memo.md「N. 時系列変化をEMが読む物語に」対応。
// レスポンス形は @emther/api-contract/timeline（Hono RPC の型推論と揃える）。
export const timelineRoute = new Hono().get("/", (c) => {
  const body = { entries: listTimelineEntries() } satisfies TimelineResponse;
  return c.json(body);
});

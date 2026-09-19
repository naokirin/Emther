import { Hono } from "hono";
import { listTimelineEntries } from "@emther/core/timeline";

// docs/2nd_architecture/plan.md フェーズ2.3: web/src/app/api/timeline/route.ts の移植。
// docs/memo.md「N. 時系列変化をEMが読む物語に」対応。
export const timelineRoute = new Hono().get("/", (c) => c.json({ entries: listTimelineEntries() }));

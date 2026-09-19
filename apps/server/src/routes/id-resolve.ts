import { Hono } from "hono";
import { isHexIdPrefix } from "@emther/core/id-prefix";
import { resolveIdPrefix } from "@emther/core/id-resolve";

// docs/2nd_architecture/plan.md フェーズ2.3: web/src/app/api/id-resolve/route.ts の移植。
export const idResolveRoute = new Hono().get("/", (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  if (!q || !isHexIdPrefix(q)) {
    return c.json({ matches: [] as ReturnType<typeof resolveIdPrefix> });
  }
  return c.json({ matches: resolveIdPrefix(q) });
});

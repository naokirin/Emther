import { Hono } from "hono";
import type { IdResolveResponse } from "@emther/api-contract";
import { isHexIdPrefix } from "@emther/core/id-prefix";
import { resolveIdPrefix } from "@emther/core/id-resolve";

export const idResolveRoute = new Hono().get("/", (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  if (!q || !isHexIdPrefix(q)) {
    const body = { matches: [] } satisfies IdResolveResponse;
    return c.json(body);
  }
  const body = { matches: resolveIdPrefix(q) } satisfies IdResolveResponse;
  return c.json(body);
});

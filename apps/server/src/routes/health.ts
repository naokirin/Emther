import { Hono } from "hono";
import type { HealthResponse } from "@emther/api-contract/health";

export const healthRoute = new Hono().get("/", (c) => {
  const body = { ok: true } satisfies HealthResponse;
  return c.json(body);
});

import { Hono } from "hono";
import type { WorldModelListResponse, WorldModelMutationResponse } from "@emther/api-contract";
import {
  adoptWorldModelElement,
  annotateWorldModelElement,
  confirmWorldModelElement,
  createWorldModelElement,
  dismissWorldModelElement,
  getWorldModelElement,
  listWorldModelElements,
  pinWorldModelElement,
  reviseWorldModelElement,
  toWorldModelView,
  unpinWorldModelElement,
  WORLD_MODEL_KINDS,
  WorldModelValidationError,
  type WorldModelElement,
  type WorldModelKind,
  type WorldModelStatus,
} from "@emther/core/world-model-store";

function mutation(c: { json: (b: unknown, s?: 200 | 404) => Response }, el: WorldModelElement | undefined) {
  if (!el) return c.json({ error: "not found" }, 404);
  return c.json({ element: toWorldModelView(el) } satisfies WorldModelMutationResponse);
}

export const worldModelRoute = new Hono()
  .get("/", (c) => {
    const status = c.req.query("status") as WorldModelStatus | undefined;
    const kind = c.req.query("kind") as WorldModelKind | undefined;
    if (kind && !WORLD_MODEL_KINDS.includes(kind)) return c.json({ error: "unknown kind" }, 400);
    const body = {
      elements: listWorldModelElements({ status, kind }).map(toWorldModelView),
    } satisfies WorldModelListResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid body" }, 400);
    try {
      const element = await createWorldModelElement({ ...body, origin: "user" });
      return c.json({ element: toWorldModelView(element) } satisfies WorldModelMutationResponse, 201);
    } catch (err) {
      if (err instanceof WorldModelValidationError) return c.json({ error: err.message }, 400);
      throw err;
    }
  })
  .get("/:id", (c) => {
    const el = getWorldModelElement(c.req.param("id"));
    return mutation(c, el);
  })
  .post("/:id/adopt", (c) => mutation(c, adoptWorldModelElement(c.req.param("id"))))
  .post("/:id/dismiss", (c) => mutation(c, dismissWorldModelElement(c.req.param("id"))))
  .post("/:id/pin", (c) => mutation(c, pinWorldModelElement(c.req.param("id"))))
  .post("/:id/unpin", (c) => mutation(c, unpinWorldModelElement(c.req.param("id"))))
  .post("/:id/confirm", (c) => mutation(c, confirmWorldModelElement(c.req.param("id"))))
  .patch("/:id/note", async (c) => {
    const body = await c.req.json().catch(() => null);
    const note = typeof body?.note === "string" ? body.note : null;
    return mutation(c, await annotateWorldModelElement(c.req.param("id"), note));
  })
  .post("/:id/revise", async (c) => {
    const body = await c.req.json().catch(() => null);
    try {
      const revised = await reviseWorldModelElement(c.req.param("id"), {
        title: typeof body?.title === "string" ? body.title : undefined,
        statement: typeof body?.statement === "string" ? body.statement : undefined,
      });
      return mutation(c, revised);
    } catch (err) {
      if (err instanceof WorldModelValidationError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

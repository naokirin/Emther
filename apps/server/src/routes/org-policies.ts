import { Hono } from "hono";
import type { OkResponse, PoliciesResponse, PolicyMutationResponse } from "@emther/api-contract";
import {
  addPolicy,
  listPolicies,
  removePolicy,
  reorderPolicies,
  toPolicyView,
  updatePolicy,
  type PolicyCategory,
} from "@emther/core/org-context-store/index";

function parseReorderIds(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const ids = (body as { ids?: unknown }).ids;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  if (!ids.every((id): id is string => typeof id === "string" && !!id)) return null;
  return ids;
}

function parseCategory(value: unknown): PolicyCategory | undefined {
  return value === "value" || value === "priority" || value === "avoid" || value === "principle" || value === "other"
    ? value
    : undefined;
}

// Goal ルートと同型の Policy CRUD。
export const orgPoliciesRoute = new Hono()
  .get("/", (c) => {
    const body = { policies: listPolicies().map(toPolicyView) } satisfies PoliciesResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return c.json({ error: "textは必須です" }, 400);
    }
    const category = parseCategory(body?.category);
    const elaboration =
      typeof body?.elaboration === "string" && body.elaboration.trim() ? body.elaboration.trim() : undefined;

    try {
      const entry = await addPolicy({ text, category, elaboration });
      const resBody = { policy: toPolicyView(entry) } satisfies PolicyMutationResponse;
      return c.json(resBody, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  })
  .post("/reorder", async (c) => {
    const ids = parseReorderIds(await c.req.json().catch(() => null));
    if (!ids) {
      return c.json({ error: "idsは1件以上の文字列配列です" }, 400);
    }
    try {
      const policies = reorderPolicies(ids).map(toPolicyView);
      const resBody = { policies } satisfies PoliciesResponse;
      return c.json(resBody);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "bodyが必要です" }, 400);
    }

    const patch: {
      text?: string;
      elaboration?: string | null;
      category?: PolicyCategory | null;
      archivedAt?: number | null;
    } = {};

    if ("text" in body && typeof body.text === "string") patch.text = body.text;
    if ("elaboration" in body) {
      patch.elaboration = typeof body.elaboration === "string" ? body.elaboration : null;
    }
    if ("category" in body) {
      patch.category = body.category === null ? null : parseCategory(body.category) ?? null;
    }
    if ("archived" in body) {
      patch.archivedAt = body.archived ? Date.now() : null;
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ error: "更新フィールドがありません" }, 400);
    }

    const entry = await updatePolicy(id, patch);
    if (!entry) {
      return c.json({ error: "not found" }, 404);
    }
    const resBody = { policy: toPolicyView(entry) } satisfies PolicyMutationResponse;
    return c.json(resBody);
  })
  .delete("/:id", (c) => {
    const removed = removePolicy(c.req.param("id"));
    if (!removed) {
      return c.json({ error: "not found" }, 404);
    }
    const resBody = { ok: true } satisfies OkResponse;
    return c.json(resBody);
  });

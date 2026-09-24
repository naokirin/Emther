import { Hono } from "hono";
import type { GlossaryEntryMutationResponse, GlossaryListResponse, OkResponse } from "@emther/api-contract";
import {
  addGlossaryEntry,
  deleteGlossaryEntry,
  getGlossaryEntry,
  listGlossaryEntries,
  updateGlossaryEntry,
} from "@emther/core/glossary-store";

export const glossaryRoute = new Hono()
  .get("/", (c) => {
    const body = { entries: listGlossaryEntries() } satisfies GlossaryListResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const term = typeof body?.term === "string" ? body.term.trim() : "";
    const meaning = typeof body?.meaning === "string" ? body.meaning.trim() : "";
    const reading = typeof body?.reading === "string" ? body.reading.trim() : undefined;
    const category = typeof body?.category === "string" ? body.category.trim() : undefined;

    if (!term || !meaning) {
      return c.json({ error: "term と meaning は必須です" }, 400);
    }

    const entry = addGlossaryEntry({ term, reading, meaning, category });
    const resBody = { entry } satisfies GlossaryEntryMutationResponse;
    return c.json(resBody, 201);
  })
  .get("/:id", (c) => {
    const entry = getGlossaryEntry(c.req.param("id"));
    if (!entry) return c.json({ error: "not found" }, 404);
    return c.json({ entry });
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const updated = updateGlossaryEntry(id, {
      term: typeof body?.term === "string" ? body.term : undefined,
      reading: typeof body?.reading === "string" ? body.reading : undefined,
      meaning: typeof body?.meaning === "string" ? body.meaning : undefined,
      category: typeof body?.category === "string" ? body.category : undefined,
    });

    if (!updated) return c.json({ error: "not found" }, 404);
    const resBody = { entry: updated } satisfies GlossaryEntryMutationResponse;
    return c.json(resBody);
  })
  .delete("/:id", (c) => {
    const success = deleteGlossaryEntry(c.req.param("id"));
    if (!success) return c.json({ error: "not found" }, 404);
    const resBody = { ok: true } satisfies OkResponse;
    return c.json(resBody);
  });

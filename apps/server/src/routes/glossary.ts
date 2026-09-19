import { Hono } from "hono";
import {
  addGlossaryEntry,
  deleteGlossaryEntry,
  getGlossaryEntry,
  listGlossaryEntries,
  updateGlossaryEntry,
} from "@emther/core/glossary-store";

// docs/2nd_architecture/plan.md フェーズ2.3: web/src/app/api/glossary/{route,[id]/route}.ts の移植。
export const glossaryRoute = new Hono()
  .get("/", (c) => c.json({ entries: listGlossaryEntries() }))
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
    return c.json({ entry }, 201);
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
    return c.json({ entry: updated });
  })
  .delete("/:id", (c) => {
    const success = deleteGlossaryEntry(c.req.param("id"));
    if (!success) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

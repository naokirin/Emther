import { Hono } from "hono";
import type {
  EmCheckinMutationResponse,
  EmCheckinsResponse,
  ReflectionNoteMutationResponse,
  ReflectionNotesResponse,
} from "@emther/api-contract";
import {
  addCheckin,
  addReflectionNote,
  listCheckins,
  listReflectionNotes,
  setReflectionNoteArchived,
  toCheckinView,
  toReflectionNoteView,
} from "@emther/core/em-self-store";
import { dateStringToNoonTimestamp } from "@emther/core/journal-date-parser";

export const checkinsRoute = new Hono()
  .get("/", (c) => {
    const body = { checkins: listCheckins().map(toCheckinView) } satisfies EmCheckinsResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const mood = Number(body?.mood);
    const energy = Number(body?.energy);
    const stress = Number(body?.stress);
    const headroom = Number(body?.headroom);
    if (
      !Number.isFinite(mood) ||
      !Number.isFinite(energy) ||
      !Number.isFinite(stress) ||
      !Number.isFinite(headroom)
    ) {
      return c.json({ error: "mood/energy/stress/headroomは数値である必要があります" }, 400);
    }
    const note = typeof body?.note === "string" ? body.note : "";

    // createdAtDateは"YYYY-MM-DD"（日付レベルのみ）。省略時は Date.now()
    let createdAt: number | undefined;
    if (typeof body?.createdAtDate === "string" && body.createdAtDate) {
      createdAt = dateStringToNoonTimestamp(body.createdAtDate);
      if (createdAt === undefined) {
        return c.json({ error: "createdAtDateの形式が不正です（YYYY-MM-DD）" }, 400);
      }
    }

    const checkin = await addCheckin({ mood, energy, stress, headroom, note, createdAt });
    const resBody = { checkin: toCheckinView(checkin) } satisfies EmCheckinMutationResponse;
    return c.json(resBody, 201);
  });

// 1回のPOST＝1件のKeep/Problem/Tryメモ。週単位のグルーピングは
// growth/page.tsx側で行う（サーバー側は個々のメモを時系列で持つだけ）
export const reflectionNotesRoute = new Hono()
  .get("/", (c) => {
    const body = { notes: listReflectionNotes().map(toReflectionNoteView) } satisfies ReflectionNotesResponse;
    return c.json(body);
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const type = body?.type;
    if (type !== "keep" && type !== "problem" && type !== "try") {
      return c.json({ error: "typeはkeep/problem/tryのいずれかである必要があります" }, 400);
    }
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return c.json({ error: "textは必須です" }, 400);
    }

    let createdAt: number | undefined;
    if (typeof body?.createdAtDate === "string" && body.createdAtDate) {
      createdAt = dateStringToNoonTimestamp(body.createdAtDate);
      if (createdAt === undefined) {
        return c.json({ error: "createdAtDateの形式が不正です（YYYY-MM-DD）" }, 400);
      }
    }

    const note = await addReflectionNote({ type, text, createdAt });
    const resBody = { note: toReflectionNoteView(note) } satisfies ReflectionNoteMutationResponse;
    return c.json(resBody, 201);
  })
  // archived=true で方針パネルから外し、false で戻す（誤操作の取り消し）
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (typeof body?.archived !== "boolean") {
      return c.json({ error: "archivedはbooleanである必要があります" }, 400);
    }
    const updated = setReflectionNoteArchived(id, body.archived);
    if (!updated) {
      return c.json({ error: "見つかりません" }, 404);
    }
    const resBody = { note: toReflectionNoteView(updated) } satisfies ReflectionNoteMutationResponse;
    return c.json(resBody);
  });

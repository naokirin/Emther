import { Hono } from "hono";
import { acceptDumpChunks, runParseOnDump } from "@emther/core/observation-dump-actions";
import { isImportSyntax, parseImportMappingConfig } from "@emther/core/observation-dump-mapping-types";
import { buildImportPreview } from "@emther/core/observation-dump-normalize";
import { deleteImportProfile, listImportProfiles, saveImportProfile } from "@emther/core/observation-dump-profiles";
import {
  createObservationDump,
  discardObservationDump,
  getObservationDump,
  isObservationSourceType,
  listObservationDumps,
  patchChunkDrafts,
  toObservationDumpView,
  type ChunkDisposition,
} from "@emther/core/observation-dump-store";
import { toJournalEntryViews } from "@emther/core/journal-store";
import { maskForStorage } from "@emther/core/people-directory";
import { jsonFromUnknownError, maskOptionsFromBody, maskOptionsFromBodyStrict } from "../lib/name-candidate-response";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ9）:
// web/src/app/api/journal/dumps/{route,[id]/route,[id]/parse/route,
// [id]/accept/route,preview/route,profiles/route}.ts の移植。

const DISPOSITIONS: ChunkDisposition[] = ["pending", "accept", "edit", "merge_into", "drop"];

function isDisposition(v: unknown): v is ChunkDisposition {
  return typeof v === "string" && (DISPOSITIONS as string[]).includes(v);
}

export const journalDumpsRoute = new Hono()
  // docs/observation_dump_journal.md: Dump 一覧・作成。作成後は既定で分割まで実行する。
  .get("/", (c) => c.json({ dumps: listObservationDumps().map(toObservationDumpView) }))
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text : "";
    const sourceType = body?.sourceType;
    const title = typeof body?.title === "string" ? body.title : undefined;
    const parse = body?.parse !== false;
    const mapping = parseImportMappingConfig(body?.mapping);
    const occurredRangeHint =
      body?.occurredRangeHint && typeof body.occurredRangeHint === "object"
        ? {
            start: typeof body.occurredRangeHint.start === "string" ? body.occurredRangeHint.start : undefined,
            end: typeof body.occurredRangeHint.end === "string" ? body.occurredRangeHint.end : undefined,
          }
        : undefined;

    if (!text.trim()) {
      return c.json({ error: "textは必須です" }, 400);
    }
    if (!isObservationSourceType(sourceType)) {
      return c.json({ error: "sourceTypeは chat_log / meeting_log / other_log のいずれかです" }, 400);
    }

    try {
      let dump = await createObservationDump({ sourceType, text, title, occurredRangeHint, mapping }, maskOptionsFromBody(body));
      if (parse) {
        dump = await runParseOnDump(dump.id);
      }
      return c.json({ dump: toObservationDumpView(dump) }, 201);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("本文(text)") || message.includes("列を確認する")) {
        return c.json({ error: message }, 400);
      }
      return jsonFromUnknownError(err);
    }
  })
  /** 貼り付けテキストから構文・列・推奨マッピングを返す（保存しない） */
  .post("/preview", async (c) => {
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text : "";
    if (!text.trim()) {
      return c.json({ error: "textは必須です" }, 400);
    }
    const syntax = isImportSyntax(body?.syntax) ? body.syntax : undefined;
    const hasHeader = typeof body?.hasHeader === "boolean" ? body.hasHeader : undefined;
    const preview = buildImportPreview(text, syntax, hasHeader);
    return c.json({ preview, profiles: listImportProfiles() });
  })
  .get("/profiles", (c) => c.json({ profiles: listImportProfiles() }))
  .post("/profiles", async (c) => {
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name : "";
    const config = parseImportMappingConfig(body?.config ?? body?.mapping);
    if (!name.trim()) {
      return c.json({ error: "nameは必須です" }, 400);
    }
    if (!config) {
      return c.json({ error: "config（mapping）が不正です" }, 400);
    }
    try {
      const profile = saveImportProfile({ id: typeof body?.id === "string" ? body.id : undefined, name, config });
      return c.json({ profile }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  })
  .delete("/profiles", async (c) => {
    const body = await c.req.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) return c.json({ error: "idは必須です" }, 400);
    if (!deleteImportProfile(id)) {
      return c.json({ error: "見つかりません" }, 404);
    }
    return c.json({ ok: true });
  })
  .get("/:id", (c) => {
    const dump = getObservationDump(c.req.param("id"));
    if (!dump) return c.json({ error: "見つかりません" }, 404);
    return c.json({ dump: toObservationDumpView(dump) });
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const dump = getObservationDump(id);
    if (!dump) return c.json({ error: "見つかりません" }, 404);

    const body = await c.req.json().catch(() => null);
    if (body?.discard === true) {
      const discarded = discardObservationDump(id);
      return c.json({ dump: toObservationDumpView(discarded!) });
    }

    try {
      const rawPatches = Array.isArray(body?.chunks) ? body.chunks : [];
      const patches: Array<{
        id: string;
        disposition?: ChunkDisposition;
        text?: string;
        suggestedOccurredAt?: string | null;
        dropReason?: string | null;
      }> = [];

      for (const item of rawPatches) {
        if (!item || typeof item.id !== "string") continue;
        const patch: (typeof patches)[number] = { id: item.id };
        if (isDisposition(item.disposition)) patch.disposition = item.disposition;
        if (typeof item.text === "string") {
          patch.text = await maskForStorage(item.text);
        }
        if (item.suggestedOccurredAt === null) patch.suggestedOccurredAt = null;
        else if (typeof item.suggestedOccurredAt === "string") {
          patch.suggestedOccurredAt = item.suggestedOccurredAt;
        }
        if (item.dropReason === null) patch.dropReason = null;
        else if (typeof item.dropReason === "string") {
          patch.dropReason = await maskForStorage(item.dropReason);
        }
        patches.push(patch);
      }

      const updated = patches.length > 0 ? patchChunkDrafts(id, patches) : dump;
      if (!updated) return c.json({ error: "更新に失敗しました" }, 500);
      return c.json({ dump: toObservationDumpView(updated) });
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  .post("/:id/parse", async (c) => {
    const id = c.req.param("id");
    if (!getObservationDump(id)) {
      return c.json({ error: "見つかりません" }, 404);
    }
    try {
      const dump = await runParseOnDump(id);
      return c.json({ dump: toObservationDumpView(dump) });
    } catch (err) {
      return jsonFromUnknownError(err);
    }
  })
  .post("/:id/accept", async (c) => {
    const id = c.req.param("id");
    if (!getObservationDump(id)) {
      return c.json({ error: "見つかりません" }, 404);
    }

    const body = await c.req.json().catch(() => null);
    const chunkIds = Array.isArray(body?.chunkIds) ? body.chunkIds.filter((x: unknown): x is string => typeof x === "string") : [];

    try {
      const { dump, entries, nameCandidateSuggestions } = await acceptDumpChunks(id, chunkIds, maskOptionsFromBodyStrict(body));
      return c.json(
        { dump: toObservationDumpView(dump), entries: toJournalEntryViews(entries, new Map()), nameCandidateSuggestions },
        201,
      );
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("選んでください") || message.includes("採用可能") || message.includes("破棄済み") || message.includes("分割処理中")) {
        return c.json({ error: message }, 400);
      }
      return jsonFromUnknownError(err);
    }
  });

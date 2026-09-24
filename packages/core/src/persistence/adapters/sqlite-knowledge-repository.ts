import type { KnowledgeEventRepository } from "../../knowledge/knowledge-repository";
import type {
  EventPageFilter,
  KnowledgeContext,
  KnowledgeEntityType,
  KnowledgeEvent,
  KnowledgeKind,
} from "../../knowledge/knowledge-types";
import { createSqliteExecutor, type SqliteExecutor } from "../sqlite-executor";

type Row = {
  id: string;
  kind: string;
  context: string;
  entity_type: string;
  entity_id: string | null;
  people_json: string;
  team_ids_json: string | null;
  text: string;
  tags_json: string;
  urgency: string | null;
  sentiment: string | null;
  summary: string | null;
  occurred_at: number;
  recorded_at: number;
  ttl_days: number | null;
  supersedes: string | null;
  source_journal_id: string | null;
  embedding_json: string | null;
  resolved_suggestion_id: string | null;
  resolution_note: string | null;
  source_dump_id: string | null;
  source_chunk_id: string | null;
  no_action_needed_at: number | null;
  no_action_needed_note: string | null;
  archived_at: number | null;
  archived_reason: string | null;
  sensitive_at: number | null;
};

function rowToEvent(row: Row): KnowledgeEvent {
  return {
    id: row.id,
    kind: row.kind as KnowledgeKind,
    context: row.context as KnowledgeContext,
    entityType: row.entity_type as KnowledgeEntityType,
    entityId: row.entity_id ?? undefined,
    people: JSON.parse(row.people_json),
    teamIds: row.team_ids_json ? (JSON.parse(row.team_ids_json) as string[]) : [],
    text: row.text,
    tags: JSON.parse(row.tags_json),
    urgency: (row.urgency as KnowledgeEvent["urgency"]) ?? undefined,
    sentiment: (row.sentiment as KnowledgeEvent["sentiment"]) ?? undefined,
    summary: row.summary ?? undefined,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    ttlDays: row.ttl_days ?? undefined,
    supersedes: row.supersedes ?? undefined,
    sourceJournalId: row.source_journal_id ?? undefined,
    embedding: row.embedding_json ? JSON.parse(row.embedding_json) : undefined,
    resolvedSuggestionId: row.resolved_suggestion_id ?? undefined,
    resolutionNote: row.resolution_note ?? undefined,
    sourceDumpId: row.source_dump_id ?? undefined,
    sourceChunkId: row.source_chunk_id ?? undefined,
    noActionNeededAt: row.no_action_needed_at ?? undefined,
    noActionNeededNote: row.no_action_needed_note ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    archivedReason: row.archived_reason === "name_leak" ? "name_leak" : undefined,
    sensitiveAt: row.sensitive_at ?? undefined,
  };
}

// ユーザー指摘「一覧の全件取得をページネーション化したい」対応。値そのものをSQL文字列へ
// 連結することはない（常にbind parameter経由）が、LIKEのワイルドカード文字（%・_）は
// 値の中に含まれると意図しない部分一致を起こすため、リテラルとして扱うためにエスケープする。
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function buildEventPageWhere(filter: EventPageFilter): { where: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.entityType) {
    conditions.push("entity_type = ?");
    params.push(filter.entityType);
  }
  if (filter.kind) {
    conditions.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.urgency) {
    conditions.push("urgency = ?");
    params.push(filter.urgency);
  }
  if (filter.sentiment) {
    conditions.push("sentiment = ?");
    params.push(filter.sentiment);
  }
  if (filter.occurredAtFrom !== undefined) {
    conditions.push("occurred_at >= ?");
    params.push(filter.occurredAtFrom);
  }
  if (filter.textQuery) {
    const queries = (Array.isArray(filter.textQuery) ? filter.textQuery : [filter.textQuery]).filter(Boolean);
    if (queries.length === 1) {
      const like = `%${escapeLike(queries[0])}%`;
      conditions.push(
        "(text LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\' OR people_json LIKE ? ESCAPE '\\')",
      );
      params.push(like, like, like, like);
    } else if (queries.length > 1) {
      const parts: string[] = [];
      for (const q of queries) {
        const like = `%${escapeLike(q)}%`;
        parts.push(
          "(text LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\' OR people_json LIKE ? ESCAPE '\\')",
        );
        params.push(like, like, like, like);
      }
      conditions.push(`(${parts.join(" OR ")})`);
    }
  }
  if (filter.tagExact) {
    const tags = (Array.isArray(filter.tagExact) ? filter.tagExact : [filter.tagExact]).filter(Boolean);
    if (tags.length === 1) {
      conditions.push("tags_json LIKE ? ESCAPE '\\'");
      params.push(`%"${escapeLike(tags[0])}"%`);
    } else if (tags.length > 1) {
      const parts = tags.map(() => "tags_json LIKE ? ESCAPE '\\'");
      for (const t of tags) params.push(`%"${escapeLike(t)}"%`);
      conditions.push(`(${parts.join(" OR ")})`);
    }
  }
  if (filter.personExact) {
    conditions.push("people_json LIKE ? ESCAPE '\\'");
    params.push(`%"${escapeLike(filter.personExact)}"%`);
  }
  if (filter.excludeResolved) {
    conditions.push("resolved_suggestion_id IS NULL AND (resolution_note IS NULL OR resolution_note = '')");
  }
  if (filter.excludeSuperseded) {
    conditions.push("id NOT IN (SELECT supersedes FROM knowledge_events WHERE supersedes IS NOT NULL)");
  }
  if (filter.excludeArchived) {
    conditions.push("archived_at IS NULL");
  }
  if (filter.archivedReasonExact) {
    conditions.push("archived_reason = ?");
    params.push(filter.archivedReasonExact);
  }
  if (filter.excludeSensitive) {
    conditions.push("sensitive_at IS NULL");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

export function createSqliteKnowledgeRepository(
  db: SqliteExecutor = createSqliteExecutor(),
): KnowledgeEventRepository {
  return {
    findById(id: string): KnowledgeEvent | undefined {
      const row = db.get<Row>("SELECT * FROM knowledge_events WHERE id = ?", id);
      return row ? rowToEvent(row) : undefined;
    },

    insert(event: KnowledgeEvent): void {
      db.run(
        `INSERT INTO knowledge_events
          (id, kind, context, entity_type, entity_id, people_json, team_ids_json, text, tags_json, urgency, sentiment, summary, occurred_at, recorded_at, ttl_days, supersedes, source_journal_id, embedding_json, resolved_suggestion_id, resolution_note, source_dump_id, source_chunk_id, sensitive_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        event.id,
        event.kind,
        event.context,
        event.entityType,
        event.entityId ?? null,
        JSON.stringify(event.people),
        JSON.stringify(event.teamIds),
        event.text,
        JSON.stringify(event.tags),
        event.urgency ?? null,
        event.sentiment ?? null,
        event.summary ?? null,
        event.occurredAt,
        event.recordedAt,
        event.ttlDays ?? null,
        event.supersedes ?? null,
        event.sourceJournalId ?? null,
        event.embedding ? JSON.stringify(event.embedding) : null,
        event.resolvedSuggestionId ?? null,
        event.resolutionNote ?? null,
        event.sourceDumpId ?? null,
        event.sourceChunkId ?? null,
        event.sensitiveAt ?? null,
      );
    },

    findNewestSuperseding(id: string): KnowledgeEvent | undefined {
      const row = db.get<Row>(
        "SELECT * FROM knowledge_events WHERE supersedes = ? ORDER BY recorded_at DESC LIMIT 1",
        id,
      );
      return row ? rowToEvent(row) : undefined;
    },

    list(filter?: { entityType?: KnowledgeEntityType; kind?: KnowledgeKind }): KnowledgeEvent[] {
      const conditions: string[] = [];
      const params: string[] = [];
      if (filter?.entityType) {
        conditions.push("entity_type = ?");
        params.push(filter.entityType);
      }
      if (filter?.kind) {
        conditions.push("kind = ?");
        params.push(filter.kind);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      // occurred_atが同値（例: 「まとめて記録する」で同日イベントが同じ正午時刻を
      // 共有するケース）の場合、recorded_at（記録した実時刻）で降順のタイブレークを
      // かけないと、SQLiteの不定順（実質的に古い順）で返り、新しく登録した方が
      // 一覧の下に来てしまう。
      return db
        .all<Row>(`SELECT * FROM knowledge_events ${where} ORDER BY occurred_at DESC, recorded_at DESC`, ...params)
        .map(rowToEvent);
    },

    countMatching(filter: EventPageFilter): number {
      const { where, params } = buildEventPageWhere(filter);
      const totalRow = db.get<{ c: number }>(`SELECT COUNT(*) as c FROM knowledge_events ${where}`, ...params);
      return totalRow?.c ?? 0;
    },

    listPage(filter: EventPageFilter, opts: { limit: number; offset: number }): KnowledgeEvent[] {
      const { where, params } = buildEventPageWhere(filter);
      return db
        .all<Row>(
          `SELECT * FROM knowledge_events ${where} ORDER BY occurred_at DESC, recorded_at DESC LIMIT ? OFFSET ?`,
          ...params,
          opts.limit,
          opts.offset,
        )
        .map(rowToEvent);
    },

    countBefore(target: { occurredAt: number; recordedAt: number }, filter: EventPageFilter): number {
      const { where, params } = buildEventPageWhere(filter);
      const orderCondition = "(occurred_at > ? OR (occurred_at = ? AND recorded_at > ?))";
      const combinedWhere = where ? `${where} AND ${orderCondition}` : `WHERE ${orderCondition}`;
      const row = db.get<{ c: number }>(
        `SELECT COUNT(*) as c FROM knowledge_events ${combinedWhere}`,
        ...params,
        target.occurredAt,
        target.occurredAt,
        target.recordedAt,
      );
      return row?.c ?? 0;
    },

    listFacetRows(filter: {
      entityType?: KnowledgeEntityType;
      kind?: KnowledgeKind;
      excludeSuperseded?: boolean;
      excludeArchived?: boolean;
      excludeSensitive?: boolean;
    }): Array<{ tags: string[]; people: string[] }> {
      const conditions: string[] = [];
      const params: string[] = [];
      if (filter.entityType) {
        conditions.push("entity_type = ?");
        params.push(filter.entityType);
      }
      if (filter.kind) {
        conditions.push("kind = ?");
        params.push(filter.kind);
      }
      if (filter.excludeSuperseded) {
        conditions.push("id NOT IN (SELECT supersedes FROM knowledge_events WHERE supersedes IS NOT NULL)");
      }
      if (filter.excludeArchived) {
        conditions.push("archived_at IS NULL");
      }
      if (filter.excludeSensitive) {
        conditions.push("sensitive_at IS NULL");
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      return db
        .all<{ tags_json: string; people_json: string }>(
          `SELECT tags_json, people_json FROM knowledge_events ${where}`,
          ...params,
        )
        .map((row) => ({
          tags: JSON.parse(row.tags_json) as string[],
          people: JSON.parse(row.people_json) as string[],
        }));
    },

    updateNoActionNeeded(
      id: string,
      patch: { at: number | null; note: string | null },
    ): KnowledgeEvent | undefined {
      const row = db.get<Row>("SELECT * FROM knowledge_events WHERE id = ?", id);
      if (!row) return undefined;
      db.run(
        "UPDATE knowledge_events SET no_action_needed_at = ?, no_action_needed_note = ? WHERE id = ?",
        patch.at,
        patch.note,
        id,
      );
      return rowToEvent({ ...row, no_action_needed_at: patch.at, no_action_needed_note: patch.note });
    },

    updateArchived(
      id: string,
      patch: { at: number | null; reason: "name_leak" | null },
    ): KnowledgeEvent | undefined {
      const row = db.get<Row>("SELECT * FROM knowledge_events WHERE id = ?", id);
      if (!row) return undefined;
      db.run(
        "UPDATE knowledge_events SET archived_at = ?, archived_reason = ? WHERE id = ?",
        patch.at,
        patch.reason,
        id,
      );
      return rowToEvent({ ...row, archived_at: patch.at, archived_reason: patch.reason });
    },

    updateSensitive(id: string, at: number | null): KnowledgeEvent | undefined {
      const row = db.get<Row>("SELECT * FROM knowledge_events WHERE id = ?", id);
      if (!row) return undefined;
      db.run("UPDATE knowledge_events SET sensitive_at = ? WHERE id = ?", at, id);
      return rowToEvent({ ...row, sensitive_at: at });
    },

    listUnarchivedTextRows(): Array<{
      id: string;
      text: string;
      summary?: string;
      tags: string[];
      resolutionNote?: string;
    }> {
      return db
        .all<{
          id: string;
          text: string;
          summary: string | null;
          tags_json: string;
          resolution_note: string | null;
        }>("SELECT id, text, summary, tags_json, resolution_note FROM knowledge_events WHERE archived_at IS NULL")
        .map((row) => ({
          id: row.id,
          text: row.text,
          summary: row.summary ?? undefined,
          tags: JSON.parse(row.tags_json) as string[],
          resolutionNote: row.resolution_note ?? undefined,
        }));
    },

    listPersonFieldRows(): Array<{
      id: string;
      text: string;
      summary?: string;
      tagsJson: string;
      peopleJson: string;
      resolutionNote?: string;
    }> {
      return db
        .all<{
          id: string;
          text: string;
          summary: string | null;
          tags_json: string;
          people_json: string;
          resolution_note: string | null;
        }>("SELECT id, text, summary, tags_json, people_json, resolution_note FROM knowledge_events")
        .map((row) => ({
          id: row.id,
          text: row.text,
          summary: row.summary ?? undefined,
          tagsJson: row.tags_json,
          peopleJson: row.people_json,
          resolutionNote: row.resolution_note ?? undefined,
        }));
    },

    updatePersonFields(
      id: string,
      fields: {
        text: string;
        summary: string | null;
        tagsJson: string;
        peopleJson: string;
        resolutionNote: string | null;
      },
    ): void {
      db.run(
        "UPDATE knowledge_events SET text = ?, summary = ?, tags_json = ?, people_json = ?, resolution_note = ? WHERE id = ?",
        fields.text,
        fields.summary,
        fields.tagsJson,
        fields.peopleJson,
        fields.resolutionNote,
        id,
      );
    },

    listSearchCandidates(filter?: {
      kind?: KnowledgeKind;
      excludeArchived?: boolean;
      excludeSuperseded?: boolean;
    }): Array<{ id: string; occurredAt: number; ttlDays?: number; embedding: number[] }> {
      const conditions = ["embedding_json IS NOT NULL"];
      const params: string[] = [];
      if (filter?.kind) {
        conditions.push("kind = ?");
        params.push(filter.kind);
      }
      if (filter?.excludeArchived ?? true) {
        conditions.push("archived_at IS NULL");
      }
      if (filter?.excludeSuperseded ?? true) {
        conditions.push("id NOT IN (SELECT supersedes FROM knowledge_events WHERE supersedes IS NOT NULL)");
      }
      const where = `WHERE ${conditions.join(" AND ")}`;
      return db
        .all<{
          id: string;
          occurred_at: number;
          ttl_days: number | null;
          embedding_json: string;
        }>(`SELECT id, occurred_at, ttl_days, embedding_json FROM knowledge_events ${where}`, ...params)
        .map((row) => ({
          id: row.id,
          occurredAt: row.occurred_at,
          ttlDays: row.ttl_days ?? undefined,
          embedding: JSON.parse(row.embedding_json) as number[],
        }));
    },

    findByIds(ids: string[]): KnowledgeEvent[] {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(", ");
      const rows = db.all<Row>(`SELECT * FROM knowledge_events WHERE id IN (${placeholders})`, ...ids);
      const byId = new Map(rows.map((row) => [row.id, rowToEvent(row)]));
      return ids.map((id) => byId.get(id)).filter((e): e is KnowledgeEvent => e !== undefined);
    },
  };
}

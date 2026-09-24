import type {
  EventPageFilter,
  KnowledgeEntityType,
  KnowledgeEvent,
  KnowledgeKind,
} from "./knowledge-types";

/**
 * ナレッジイベントの永続化ポート。
 * ドメインは SQL / getDb を知らない。
 */
export type KnowledgeEventRepository = {
  findById(id: string): KnowledgeEvent | undefined;
  insert(event: KnowledgeEvent): void;
  findNewestSuperseding(id: string): KnowledgeEvent | undefined;
  list(filter?: { entityType?: KnowledgeEntityType; kind?: KnowledgeKind }): KnowledgeEvent[];
  countMatching(filter: EventPageFilter): number;
  listPage(filter: EventPageFilter, opts: { limit: number; offset: number }): KnowledgeEvent[];
  countBefore(target: { occurredAt: number; recordedAt: number }, filter: EventPageFilter): number;
  listFacetRows(filter: {
    entityType?: KnowledgeEntityType;
    kind?: KnowledgeKind;
    excludeSuperseded?: boolean;
    excludeArchived?: boolean;
    excludeSensitive?: boolean;
  }): Array<{ tags: string[]; people: string[] }>;
  updateNoActionNeeded(
    id: string,
    patch: { at: number | null; note: string | null },
  ): KnowledgeEvent | undefined;
  updateArchived(
    id: string,
    patch: { at: number | null; reason: "name_leak" | null },
  ): KnowledgeEvent | undefined;
  updateSensitive(id: string, at: number | null): KnowledgeEvent | undefined;
  listUnarchivedTextRows(): Array<{
    id: string;
    text: string;
    summary?: string;
    tags: string[];
    resolutionNote?: string;
  }>;
  listPersonFieldRows(): Array<{
    id: string;
    text: string;
    summary?: string;
    tagsJson: string;
    peopleJson: string;
    resolutionNote?: string;
  }>;
  updatePersonFields(
    id: string,
    fields: {
      text: string;
      summary: string | null;
      tagsJson: string;
      peopleJson: string;
      resolutionNote: string | null;
    },
  ): void;
  listSearchCandidates(filter?: {
    kind?: KnowledgeKind;
    excludeArchived?: boolean;
    excludeSuperseded?: boolean;
  }): Array<{ id: string; occurredAt: number; ttlDays?: number; embedding: number[] }>;
  findByIds(ids: string[]): KnowledgeEvent[];
};

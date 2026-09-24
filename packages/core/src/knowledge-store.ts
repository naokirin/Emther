// 公開ファサード。deep import `@emther/core/knowledge-store` 互換。

import { createKnowledgeService } from "./knowledge/knowledge-domain";
import { createSqliteKnowledgeRepository } from "./persistence/adapters/sqlite-knowledge-repository";

export type {
  EventPageFilter,
  KnowledgeContext,
  KnowledgeEntityType,
  KnowledgeEvent,
  KnowledgeKind,
  NewKnowledgeEvent,
} from "./knowledge/knowledge-types";

const service = createKnowledgeService(createSqliteKnowledgeRepository());

export const setEventNoActionNeeded = service.setEventNoActionNeeded;
export const clearEventNoActionNeeded = service.clearEventNoActionNeeded;
export const setEventArchived = service.setEventArchived;
export const clearEventArchived = service.clearEventArchived;
export const setEventSensitive = service.setEventSensitive;
export const clearEventSensitive = service.clearEventSensitive;
export const quarantineEventsContainingNames = service.quarantineEventsContainingNames;
export const recordEvent = service.recordEvent;
export const getEventById = service.getEventById;
export const getEventHeadById = service.getEventHeadById;
export const listEventLineageIds = service.listEventLineageIds;
export const listEvents = service.listEvents;
export const listEventsPage = service.listEventsPage;
export const findEventOffset = service.findEventOffset;
export const listEventFacets = service.listEventFacets;
export const isEventExpired = service.isEventExpired;
export const listActiveFactsForPerson = service.listActiveFactsForPerson;
export const listInterpretationsForPerson = service.listInterpretationsForPerson;
export const toEventView = service.toEventView;
export const listEventsForEntity = service.listEventsForEntity;
export const listRecentChangeEvents = service.listRecentChangeEvents;
export const recordChangeEvent = service.recordChangeEvent;
export const reassignPersonId = service.reassignPersonId;
export const searchSimilarEvents = service.searchSimilarEvents;

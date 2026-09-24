// 公開ファサード。deep import `@emther/core/person-concern-ack-store` 互換。

import { createPersonConcernAckService } from "./person-concern-ack/person-concern-ack-domain";
import { createSqlitePersonConcernAckRepository } from "./persistence/adapters/sqlite-person-concern-ack-repository";

export type { PersonSuggestionConcernAck } from "./person-concern-ack/person-concern-ack-repository";

const service = createPersonConcernAckService(createSqlitePersonConcernAckRepository());

export const acknowledgePersonSuggestionConcern = service.acknowledgePersonSuggestionConcern;
export const clearPersonSuggestionConcernAck = service.clearPersonSuggestionConcernAck;
export const listPersonSuggestionConcernAcks = service.listPersonSuggestionConcernAcks;
export const listAcknowledgedSuggestionIds = service.listAcknowledgedSuggestionIds;
export const toPersonSuggestionConcernAckView = service.toPersonSuggestionConcernAckView;

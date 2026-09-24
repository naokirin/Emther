import { maskForStorage, unmaskNames } from "../people-directory";
import type {
  PersonConcernAckRepository,
  PersonSuggestionConcernAck,
} from "./person-concern-ack-repository";

export type { PersonSuggestionConcernAck } from "./person-concern-ack-repository";

/**
 * 人物×提案の対応不要確認ドメイン。永続化は PersonConcernAckRepository 経由のみ。
 */
export function createPersonConcernAckService(repo: PersonConcernAckRepository) {
  async function acknowledgePersonSuggestionConcern(
    personId: string,
    suggestionId: string,
    note?: string,
  ): Promise<PersonSuggestionConcernAck> {
    const trimmed = note?.trim();
    const masked = trimmed ? await maskForStorage(trimmed) : undefined;
    const createdAt = Date.now();
    const ack: PersonSuggestionConcernAck = {
      personId,
      suggestionId,
      note: masked,
      createdAt,
    };
    repo.upsert(ack);
    return ack;
  }

  function clearPersonSuggestionConcernAck(personId: string, suggestionId: string): void {
    repo.delete(personId, suggestionId);
  }

  function listPersonSuggestionConcernAcks(personId: string): PersonSuggestionConcernAck[] {
    return repo.listByPerson(personId);
  }

  /** この人物について、確認済み（対応不要）の提案 IDの集合。 */
  function listAcknowledgedSuggestionIds(personId: string): Set<string> {
    return new Set(listPersonSuggestionConcernAcks(personId).map((a) => a.suggestionId));
  }

  function toPersonSuggestionConcernAckView(ack: PersonSuggestionConcernAck): PersonSuggestionConcernAck {
    return { ...ack, note: ack.note !== undefined ? unmaskNames(ack.note) : undefined };
  }

  return {
    acknowledgePersonSuggestionConcern,
    clearPersonSuggestionConcernAck,
    listPersonSuggestionConcernAcks,
    listAcknowledgedSuggestionIds,
    toPersonSuggestionConcernAckView,
  };
}

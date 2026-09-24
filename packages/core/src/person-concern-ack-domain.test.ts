import { describe, expect, it } from "vitest";
import { createPersonConcernAckService } from "./person-concern-ack/person-concern-ack-domain";
import type {
  PersonConcernAckRepository,
  PersonSuggestionConcernAck,
} from "./person-concern-ack/person-concern-ack-repository";

function createMemoryPersonConcernAckRepository(): PersonConcernAckRepository {
  const rows = new Map<string, PersonSuggestionConcernAck>();
  const key = (personId: string, suggestionId: string) => `${personId}::${suggestionId}`;
  return {
    upsert(ack) {
      rows.set(key(ack.personId, ack.suggestionId), { ...ack });
    },
    delete(personId, suggestionId) {
      rows.delete(key(personId, suggestionId));
    },
    listByPerson(personId) {
      return [...rows.values()].filter((a) => a.personId === personId);
    },
  };
}

describe("person-concern-ack-domain (in-memory repository)", () => {
  it("SQLite なしで記録・一覧・取り消しができる", async () => {
    const service = createPersonConcernAckService(createMemoryPersonConcernAckRepository());
    expect(service.listPersonSuggestionConcernAcks("PERSON_1")).toEqual([]);

    const ack = await service.acknowledgePersonSuggestionConcern("PERSON_1", "suggestion-1", "対応不要と判断");
    expect(ack.suggestionId).toBe("suggestion-1");
    expect(service.listAcknowledgedSuggestionIds("PERSON_1")).toEqual(new Set(["suggestion-1"]));

    service.clearPersonSuggestionConcernAck("PERSON_1", "suggestion-1");
    expect(service.listPersonSuggestionConcernAcks("PERSON_1")).toEqual([]);
  });
});

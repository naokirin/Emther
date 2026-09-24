export type PersonSuggestionConcernAck = {
  personId: string;
  suggestionId: string;
  note?: string;
  createdAt: number;
};

/**
 * 人物×提案の「対応不要」確認の永続化ポート。
 * ドメインは SQL / getDb を知らない。
 */
export type PersonConcernAckRepository = {
  upsert(ack: PersonSuggestionConcernAck): void;
  delete(personId: string, suggestionId: string): void;
  listByPerson(personId: string): PersonSuggestionConcernAck[];
};

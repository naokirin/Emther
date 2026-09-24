export type EvaluationLens = "outcome" | "value";
export type EvaluationLogStatus = "provisional" | "confirmed" | "discarded";
export type EvaluationPolarity = "positive" | "concern";

export type PersonEvaluationLog = {
  id: string;
  personId: string;
  lens: EvaluationLens;
  status: EvaluationLogStatus;
  polarity: EvaluationPolarity;
  sourceJournalId: string;
  valueSnapshot?: string;
  snapshotText: string;
  rationale: string;
  createdAt: number;
  updatedAt: number;
  noActionNeededAt?: number;
  noActionNeededNote?: string;
};

export type PersonEvaluationRepository = {
  insert(log: PersonEvaluationLog): void;
  listByPerson(personId: string): PersonEvaluationLog[];
  get(id: string): PersonEvaluationLog | undefined;
  updateStatus(id: string, status: EvaluationLogStatus, updatedAt: number): void;
  updateNoActionNeeded(id: string, at: number | null, note: string | null): void;
  existsActive(personId: string, sourceJournalId: string, lens: EvaluationLens): boolean;
};

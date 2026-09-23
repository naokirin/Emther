import { z } from "zod";
import { personSuggestionConcernAckSchema } from "../entities/concern-ack";
import { personEvaluationLogSchema, personProfileSchema, personSummarySchema } from "../entities/people";

export const peopleResponseSchema = z.object({
  people: z.array(personSummarySchema),
});

export const personProfileResponseSchema = z.object({
  person: personProfileSchema.nullable(),
});

export const personEvaluationLogsResponseSchema = z.object({
  logs: z.array(personEvaluationLogSchema),
});

export const personMutationResponseSchema = z.object({
  person: personProfileSchema,
});

export const personEvaluationLogMutationResponseSchema = z.object({
  log: personEvaluationLogSchema,
});

export const personConcernAckResponseSchema = z.object({
  ack: personSuggestionConcernAckSchema,
});

export type PeopleResponse = z.infer<typeof peopleResponseSchema>;
export type PersonProfileResponse = z.infer<typeof personProfileResponseSchema>;
export type PersonEvaluationLogsResponse = z.infer<typeof personEvaluationLogsResponseSchema>;
export type PersonMutationResponse = z.infer<typeof personMutationResponseSchema>;
export type PersonEvaluationLogMutationResponse = z.infer<typeof personEvaluationLogMutationResponseSchema>;
export type PersonConcernAckResponse = z.infer<typeof personConcernAckResponseSchema>;

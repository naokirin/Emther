import { z } from "zod";
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

export type PeopleResponse = z.infer<typeof peopleResponseSchema>;
export type PersonProfileResponse = z.infer<typeof personProfileResponseSchema>;
export type PersonEvaluationLogsResponse = z.infer<typeof personEvaluationLogsResponseSchema>;

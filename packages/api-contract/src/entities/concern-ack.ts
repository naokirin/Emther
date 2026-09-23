import { z } from "zod";
import type { PersonSuggestionConcernAck } from "@emther/core/person-concern-ack-store";

export const personSuggestionConcernAckSchema: z.ZodType<PersonSuggestionConcernAck> = z
  .object({
    personId: z.string(),
    suggestionId: z.string(),
    createdAt: z.number(),
  })
  .passthrough() as z.ZodType<PersonSuggestionConcernAck>;

export type { PersonSuggestionConcernAck };

import { z } from "zod";
import { rulesAndConstraintsSchema } from "../entities/rules";

export const settingsRulesResponseSchema = z.object({
  rules: rulesAndConstraintsSchema,
});

export type SettingsRulesResponse = z.infer<typeof settingsRulesResponseSchema>;

import { z } from "zod";
import { orgThemeSchema } from "../entities/theme";

export const themesResponseSchema = z.object({
  themes: z.array(orgThemeSchema),
});

export type ThemesResponse = z.infer<typeof themesResponseSchema>;

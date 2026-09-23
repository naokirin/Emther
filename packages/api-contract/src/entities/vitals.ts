import { z } from "zod";

export const vitalStatusSchema = z.enum(["good", "warn", "bad", "unknown"]);

export const teamVitalSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  status: vitalStatusSchema,
  label: z.string(),
  reason: z.string(),
  members: z.array(z.string()),
  managedByEm: z.boolean(),
});

export const coverageVitalSchema = z.object({
  status: vitalStatusSchema,
  covered: z.number(),
  total: z.number(),
  reason: z.string(),
  uncoveredMembers: z.array(z.string()),
});

export const orgVitalsSchema = z.object({
  teams: z.array(teamVitalSchema),
  oneOnOneCoverage: coverageVitalSchema,
});

export type OrgVitals = z.infer<typeof orgVitalsSchema>;

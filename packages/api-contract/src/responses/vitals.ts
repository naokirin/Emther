import { orgVitalsSchema, type OrgVitals } from "../entities/vitals";

// GET /api/vitals はエンベロープ無しで OrgVitals そのものを返す。
export const vitalsResponseSchema = orgVitalsSchema;

export type VitalsResponse = OrgVitals;

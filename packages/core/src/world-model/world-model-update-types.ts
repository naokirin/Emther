import type { RelationshipDetail, WorldModelEvidence, WorldModelKind } from "./world-model-types";

export const WORLD_MODEL_CHANGE_ACTIONS = ["confirm", "contradict", "refine", "stale", "new"] as const;
export type WorldModelChangeAction = (typeof WORLD_MODEL_CHANGE_ACTIONS)[number];

export type WorldModelUpdateStatus = "pending" | "applied" | "dismissed";

/** 既存要素に対する更新提案。EM が適用するまでモデルは変わらない。 */
export type WorldModelUpdate = {
  id: string;
  targetId: string;
  action: Exclude<WorldModelChangeAction, "new">;
  reason: string;
  /** refine / contradict の置き換え案。 */
  statement?: string;
  evidence: WorldModelEvidence;
  status: WorldModelUpdateStatus;
  sourceRunId?: string;
  createdAt: number;
  resolvedAt?: number;
};

/** Agent が返す差分の1件（パース済み・未検証）。 */
export type SuggestedWorldModelChange = {
  action: WorldModelChangeAction;
  targetId?: string;
  reason: string;
  statement?: string;
  kind?: WorldModelKind;
  title?: string;
  teamIds?: string[];
  personIds?: string[];
  relationship?: RelationshipDetail;
  confidence?: "low" | "mid" | "high";
  evidence?: Partial<WorldModelEvidence>;
};

export type WorldModelIngestResult = { created: number; proposals: number; skipped: number };

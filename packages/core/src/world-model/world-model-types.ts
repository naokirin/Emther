export const WORLD_MODEL_KINDS = [
  "structure",
  "flow",
  "dependency",
  "dynamic",
  "condition",
  "external",
  "risk",
  "relationship",
  "gap",
] as const;
export type WorldModelKind = (typeof WORLD_MODEL_KINDS)[number];

export type WorldModelStatus = "candidate" | "adopted" | "pinned" | "dismissed" | "stale";

export const RELATIONSHIP_STANCES = {
  work: ["collaboration", "handoff", "decision_rights", "information_flow"],
  psychological: ["trust", "tension", "psychological_safety", "alignment"],
} as const;
export type RelationshipAspect = keyof typeof RELATIONSHIP_STANCES;
export type RelationshipStance = (typeof RELATIONSHIP_STANCES)[RelationshipAspect][number];

export type RelationshipParty = { type: "team" | "person"; id: string };

export type RelationshipDetail = {
  parties: [RelationshipParty, RelationshipParty];
  aspect: RelationshipAspect;
  stance: RelationshipStance;
};

export type WorldModelEvidence = {
  eventIds: string[];
  journalIds: string[];
  suggestionIds: string[];
  themeIds: string[];
};

export const ELEMENT_LINK_TYPES = [
  "depends_on",
  "influences",
  "conflicts_with",
  "explains",
  "gap_between",
] as const;
export type ElementLinkType = (typeof ELEMENT_LINK_TYPES)[number];

export type ElementLink = { toId: string; type: ElementLinkType };

export type WorldModelElement = {
  id: string;
  kind: WorldModelKind;
  title: string;
  statement: string;
  teamIds: string[];
  personIds: string[];
  relationship?: RelationshipDetail;
  /** gap 要素が参照する Goal / Policy / Theme の ID。 */
  intentRefs: string[];
  links: ElementLink[];
  evidence: WorldModelEvidence;
  confidence: "low" | "mid" | "high";
  status: WorldModelStatus;
  origin: "ai" | "user";
  userNote?: string;
  sourceRunId?: string;
  supersedes?: string;
  firstObservedAt: number;
  lastConfirmedAt: number;
  createdAt: number;
  updatedAt: number;
  adoptedAt?: number;
};

export type NewWorldModelElement = {
  kind: WorldModelKind;
  title: string;
  statement: string;
  teamIds?: string[];
  personIds?: string[];
  relationship?: RelationshipDetail;
  intentRefs?: string[];
  links?: ElementLink[];
  evidence?: Partial<WorldModelEvidence>;
  confidence?: WorldModelElement["confidence"];
  origin?: WorldModelElement["origin"];
  status?: WorldModelStatus;
  sourceRunId?: string;
  firstObservedAt?: number;
};

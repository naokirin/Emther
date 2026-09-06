// 複数ページ（Dashboard / Issues / Issue詳細 / Organization Context）から共有する型定義。

export type JournalEntry = {
  id: string;
  rawText: string;
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
  createdAt: number;
};

export type Team = {
  id: string;
  name: string;
  members: string[];
  createdAt: number;
};

export type VitalStatus = "good" | "warn" | "bad" | "unknown";

export type TeamVital = {
  teamId: string;
  teamName: string;
  status: VitalStatus;
  label: string;
  reason: string;
};

export type CoverageVital = {
  status: VitalStatus;
  covered: number;
  total: number;
  reason: string;
};

export type OrgVitals = {
  teams: TeamVital[];
  oneOnOneCoverage: CoverageVital;
};

export type ActionItem = {
  id: string;
  text: string;
  done: boolean;
};

export type Issue = {
  id: string;
  title: string;
  agentRunId?: string;
  actionItems: ActionItem[];
  createdAt: number;
  updatedAt: number;
};

export const AGENT_OPTIONS = ["Lead Agent", "People Agent", "Process Agent", "Tech Agent"];

export const VITAL_ICON: Record<VitalStatus, string> = {
  good: "🟢",
  warn: "🟡",
  bad: "🔴",
  unknown: "⚪️",
};

export const URGENCY_LABEL: Record<JournalEntry["urgency"], string> = {
  low: "Urgency: Low",
  mid: "Urgency: Mid",
  high: "Urgency: High",
};

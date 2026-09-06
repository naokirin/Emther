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

// Issueの計画・実行前に明らかにしておくべき3要素。各項目は空文字列（＝未整理）を許容する。
export type IssueCharter = {
  why: string;
  what: string;
  how: string;
};

export type Issue = {
  id: string;
  title: string;
  agentRunId?: string;
  charter: IssueCharter;
  actionItems: ActionItem[];
  parentId?: string;
  createdAt: number;
  updatedAt: number;
};

export function charterFilledCount(charter: IssueCharter): number {
  return [charter.why, charter.what, charter.how].filter((v) => v.trim().length > 0).length;
}

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

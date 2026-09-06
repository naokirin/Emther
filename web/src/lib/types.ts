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
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

// docs/memo.md TODO「チームの組織階層を入力できるようにする（チーム名で `/` をつけると
// 組織階層をつけられるようにする）」への対応。独立した親子フィールドは持たせず、
// チーム名自体を`/`区切りのパスとして解釈する軽量な設計にしている
// （例: "Engineering / Team A" → ["Engineering", "Team A"]）。
// `/`の前後の空白は名前の一部とみなさない。
export function teamPathSegments(name: string): string[] {
  return name
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

// 保存・比較用の正規化名（区切りは"/"、前後の余分な空白を除去）。
export function normalizeTeamName(name: string): string {
  const segments = teamPathSegments(name);
  return segments.length > 0 ? segments.join("/") : name.trim();
}

// 表示用（パンくず風に" / "区切りで見せる）。
export function teamDisplayName(name: string): string {
  const segments = teamPathSegments(name);
  return segments.length > 0 ? segments.join(" / ") : name;
}

export type OrgStrategy = {
  mission: string;
  vision: string;
  values: string;
  okr: string;
};

export type RulesAndConstraints = {
  teamWindowDays: number;
  minEntriesForJudgement: number;
  teamBadSentimentMax: number;
  teamWarnSentimentMax: number;
  coverageWindowDays: number;
  coverageGoodRatio: number;
  coverageWarnRatio: number;
  agentStaleAfterSeconds: number;
  agentKillAfterSeconds: number;
  journalFactTtlDays: number;
};

// docs/memo.md TODO「動いていると思ったら止まっていた、を防ぐ」への対応。
// statusが"active"のままログ更新（updatedAt）が閾値以上無ければ「応答なし」とみなす。
// 実際にkillするかどうかの判断はサーバー側（agent-runtime.tsのwatchdog）の責務で、
// これはあくまで表示用の軽量な判定（Team Vitalsの「評価不能」判定と同じ考え方）。
export function isRunStale(status: string, updatedAt: number, staleAfterSeconds: number): boolean {
  return status === "active" && Date.now() - updatedAt > staleAfterSeconds * 1000;
}

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
  archived: boolean;
  tags: string[];
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

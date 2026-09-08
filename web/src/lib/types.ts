// 複数ページ（Dashboard / Issues / Issue詳細 / Organization Context）から共有する型定義。

// docs/memo.md「H: Phase 2」対応。Issue/Teamの変更履歴（KnowledgeEvent）を画面表示するための
// クライアント向け型。サーバー側の実体（@/lib/knowledge-store）とは意図的に型を分離している
// （TeamやIssue等、他の型とも同じ既存の慣習に合わせている）。
export type KnowledgeEvent = {
  id: string;
  kind: "fact" | "interpretation";
  context: "official" | "observation" | "casual" | "complaint" | "profile";
  text: string;
  tags: string[];
  occurredAt: number;
  recordedAt: number;
};

export type JournalEntry = {
  id: string;
  rawText: string;
  tags: string[];
  people: string[];
  urgency: "low" | "mid" | "high";
  sentiment: "positive" | "negative" | "neutral";
  summary: string;
  createdAt: number;
  // docs/em_human_story_and_ux.md P1-9対応。EMが一度でも校正（確認）操作を通したかどうか。
  confirmed: boolean;
  // docs/em_human_story_and_ux.md 改修依頼対応。urgencyは書き換えず、「今どこで管理
  // されているか」を別軸で持たせる。
  resolvedIssueId?: string;
  resolvedIssueTitle?: string;
  resolutionNote?: string;
};

// docs/memo.md「I. チーム単位の憲法（ミッション／制約）」対応。
export type TeamCharter = {
  mission: string;
  constraints: string;
};

export type Team = {
  id: string;
  name: string;
  members: string[];
  charter: TeamCharter;
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
};

// docs/memo.md「H. 戦略→Issue→結果の一本線」対応。以前は自由記述1本の`okr`文字列だった
// OKRを、Objective（目標）ごとにKeyResult（主要な結果）を持つ最小構造に置き換える。
// 進捗は手動入力ではなく、KeyResultへ紐付いたIssueの完了（archived）数から機械的に出す
// （Team Vitalsと同じ「観測から出す」考え方）。
export type KeyResult = {
  id: string;
  title: string;
};

export type Objective = {
  id: string;
  title: string;
  keyResults: KeyResult[];
  createdAt: number;
  updatedAt: number;
};

export type KeyResultProgress = {
  keyResultId: string;
  total: number;
  done: number;
};

export type ObjectiveWithProgress = Objective & {
  progress: KeyResultProgress[];
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
  agyFallbackAgents: string[];
  cursorFallbackAgents: string[];
  autoAnomalyDetectionEnabled: boolean;
  autoMorningSummaryEnabled: boolean;
  autoMorningSummaryHour: number;
  // ユーザー指摘「設定変更時に、それまで起動していなかったエージェントが一気に並列で
  // 起動することがある」対応。同時に「実行中」にできるエージェント（CLI子プロセス）数の
  // 上限。超過分はキューイングされ、Agent Runの一覧でstatus:"queued"として見える。
  maxParallelAgentRuns: number;
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
  members: string[];
};

export type CoverageVital = {
  status: VitalStatus;
  covered: number;
  total: number;
  reason: string;
  uncoveredMembers: string[];
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

// ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
// 進行中に思いついた時点でひとこと書き足すだけの自由記述ログ（種別を分けない）。
export type IssueLogEntry = {
  id: string;
  text: string;
  createdAt: number;
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
  logEntries: IssueLogEntry[];
  parentId?: string;
  archived: boolean;
  // docs/memo.md「L. 介入の閉ループ」対応。直近でarchived: trueになった時刻。
  archivedAt?: number;
  tags: string[];
  // docs/memo.md「H. 戦略→Issue→結果の一本線」対応。このIssueがどのKeyResultに
  // 貢献するかの紐付け（任意）。
  keyResultId?: string;
  // docs/memo.md「I. チーム単位の憲法」対応。このIssueがどのチームに関するものかの
  // 紐付け（任意）。Agent Runtimeへの動的ロードで、そのチームのMission/制約だけを
  // 絶対の前提として注入するために使う。
  teamId?: string;
  createdAt: number;
  updatedAt: number;
};

export function charterFilledCount(charter: IssueCharter): number {
  return [charter.why, charter.what, charter.how].filter((v) => v.trim().length > 0).length;
}

// docs/memo.md「F. Product Agentの追加」対応。People(人)/Process(組織運営)/Tech(実装)の
// 3象限に、Product(顧客価値・優先順位・ロードマップ)を足して4象限を埋める。
export const AGENT_OPTIONS = ["Lead Agent", "People Agent", "Process Agent", "Tech Agent", "Product Agent"];

// docs/memo.md「G. Issueに『介入の型』を足す」対応。実装タスク箱ではなく「仕組み・人・組織への
// 介入」へIssueの切り口を寄せるためのプリセット。保存先は既存のtags（新規フィールドは増やさない）で、
// why/what/howはあくまでプレースホルダー（初期文面のヒント）として使い、EMが実際に入力した内容は
// 上書きしない。
export type InterventionType = { label: string; why: string; what: string; how: string };

export const INTERVENTION_TYPES: InterventionType[] = [
  {
    label: "役割明確化",
    why: "誰が何に責任を持つか曖昧で、手戻り／待ちが発生している",
    what: "各役割の責任範囲と意思決定権限を明文化し、関係者間で合意する",
    how: "現状のタスク分担を棚卸しし、責任者不在の領域を洗い出してオーナーを割り当てる",
  },
  {
    label: "意思決定プロセス",
    why: "決まる場所が無く、現場が止まったりエスカレーションが遅れる",
    what: "何を誰がどの場で決めるかのプロセスを定義し、関係者に周知する",
    how: "現状の意思決定の流れを可視化し、詰まっているポイントに承認者・会議体を設ける",
  },
  {
    label: "依存関係の切り方",
    why: "チーム間の依存が強く、片方の遅延がもう片方をブロックしている",
    what: "依存関係を整理し、疎結合にできる境界（インターフェース・契約）を定義する",
    how: "依存元・依存先のタスクを洗い出し、非同期化やインターフェース固定で結合度を下げる",
  },
  {
    label: "1on1設計",
    why: "1on1の頻度・目的が曖昧で、メンバーの状態変化を拾えていない",
    what: "対象メンバーとの1on1の頻度・アジェンダ・記録方法を決める",
    how: "カレンダーに定例枠を確保し、Quick Journalへの記録をセットで運用する",
  },
  {
    label: "プロセス変更",
    why: "既存のプロセスがチームの実態に合わず、無駄な手戻りや待ちが生まれている",
    what: "どのプロセスをどう変えるか、変更後の運用ルールを定義する",
    how: "現状のプロセスの課題を洗い出し、小さく試して効果を見ながら本格導入する",
  },
  {
    label: "優先順位／スコープ",
    why: "何を優先すべきかの基準が無く、並行タスクで摩耗が起きている",
    what: "優先順位の基準とスコープの境界を明確にし、関係者と合意する",
    how: "影響度・緊急度などの基準を決め、バックログを並べ替えて共有する",
  },
  {
    label: "心理的安全性",
    why: "発言や失敗の共有がしづらい空気があり、問題の発見・共有が遅れている",
    what: "チームが安心して意見や懸念を言える状態を作る",
    how: "1on1やチームふりかえりで小さな懸念から拾い、対応した結果を可視化する",
  },
  {
    label: "採用・オンボーディング",
    why: "採用基準やオンボーディングの流れが定まっておらず、立ち上がりが遅い",
    what: "採用基準とオンボーディングの流れ・完了条件を明確にする",
    how: "必要スキル・カルチャーフィットの基準を整理し、最初の30/60/90日の計画を作る",
  },
];

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

// docs/memo.md「J. Peopleを第一級ハブに」対応。新規の永続化エンティティは持たず、
// 既存のpeople-directory／Journal fact・解釈／チーム所属／関連Issueを人物軸で束ねた
// 集約ビュー（@/lib/people-hub.tsのサーバー側の型と対応）。
export type PersonTrend = { positive: number; negative: number; neutral: number };

export type PersonSummary = {
  id: string;
  name: string;
  teamNames: string[];
  trend: PersonTrend;
  factCount: number;
};

export type PersonFact = {
  id: string;
  text: string;
  tags: string[];
  sentiment?: "positive" | "negative" | "neutral";
  urgency?: "low" | "mid" | "high";
  occurredAt: number;
};

export type PersonRelatedIssue = {
  id: string;
  title: string;
  archived: boolean;
  charter: IssueCharter;
};

export type PersonProfile = PersonSummary & {
  facts: PersonFact[];
  interpretations: { id: string; text: string; occurredAt: number }[];
  relatedIssues: PersonRelatedIssue[];
};

// docs/memo.md「L. 介入の閉ループ（やった→組織が変わったか）」対応。
// docs/em_human_story_and_ux.md P2-15対応でinProgressを追加（アーカイブ前の暫定値かどうか）。
export type ImpactWindow = { total: number; positive: number; negative: number };
export type IssueImpact = { windowDays: number; before: ImpactWindow; after: ImpactWindow; inProgress: boolean };

// docs/memo.md「N. 時系列変化をEMが読む物語に」対応。
export type TimelineEntityType = "journal" | "person" | "team" | "issue" | "org";

export type TimelineEntry = {
  id: string;
  entityType: TimelineEntityType;
  entityId?: string;
  entityLabel?: string;
  href?: string;
  text: string;
  occurredAt: number;
};

export const TIMELINE_ENTITY_TYPE_LABEL: Record<TimelineEntityType, string> = {
  issue: "Issue",
  team: "Team",
  org: "Objective",
  journal: "Journal",
  person: "Person",
};

// docs/memo.md TODO「Quick Journal、Issue進捗、各種イベントを週次・月次でレポーティングする
// 機能を追加する」対応。サーバー側の実体（@/lib/report-store）とは意図的に型を分離している
// （他のストアと同じ既存の慣習に合わせている）。
export type ReportPeriodType = "week" | "month";

export const REPORT_PERIOD_LABEL: Record<ReportPeriodType, string> = { week: "週次", month: "月次" };

export type ReportJournalStats = {
  total: number;
  byUrgency: { low: number; mid: number; high: number };
  bySentiment: { positive: number; negative: number; neutral: number };
  topTags: { tag: string; count: number }[];
  notableEntries: { id: string; summary: string; urgency: string; sentiment: string; occurredAt: number }[];
};

export type ReportIssueStats = {
  createdCount: number;
  archivedCount: number;
  openIncompleteCount: number;
  createdTitles: { id: string; title: string }[];
  archivedTitles: { id: string; title: string }[];
};

export type ReportEventStats = {
  total: number;
  byEntityType: Partial<Record<TimelineEntityType, number>>;
};

export type ReportStats = {
  journal: ReportJournalStats;
  issues: ReportIssueStats;
  events: ReportEventStats;
};

export type Report = {
  id: string;
  periodType: ReportPeriodType;
  periodStart: number;
  periodEnd: number;
  generatedAt: number;
  stats: ReportStats;
  note: string;
};

// docs/memo.md TODO「人間EM自体の成長に対する向き合いを作る。EM本人のバイタル、週次振り返りの
// 入力・改善方針機能を作る」対応。
export type EmCheckin = {
  id: string;
  mood: number;
  energy: number;
  stress: number;
  note: string;
  createdAt: number;
};

// 改修依頼「週次振り返りを『思いついたときに書き込み、レポートの週次で振り返る』
// 仕組みに」対応。1件＝Keep/Problem/Tryのいずれか1つの気づきメモ。週単位の集計は
// 表示側（growth/page.tsx）でcreatedAtからグルーピングする。
export type ReflectionNoteType = "keep" | "problem" | "try";

export type EmReflectionNote = {
  id: string;
  type: ReflectionNoteType;
  text: string;
  createdAt: number;
};

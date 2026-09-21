import type { JournalEntry, OrgVitals, PersonSummary, VitalStatus } from "@emther/core/types";
import { personVitalStatus, PERSON_VITAL_LABEL } from "@emther/core/types";
import { buildWeeklyJournalToneTrend, type WeeklyJournalTonePoint } from "@emther/core/daily-trends";
import type { NextAction } from "./dashboard-next-actions";
import type { SituationItem } from "./daily-situation";

// docs/design/dashboard/today-tab.pen 改善案A対応。「いまの状態」メーターと健全度内訳、
// 4週トーン比較を既存の Journal / Vitals / People / NextActions から組み立てる。

const STATUS_WEIGHT: Record<VitalStatus, number | null> = {
  good: 100,
  warn: 55,
  bad: 15,
  unknown: null,
};

export type StatusBreakdownBucket = {
  status: VitalStatus;
  count: number;
  /** 代表例（チーム名 / メンバー名）。最大2件。 */
  examples: string[];
};

export type EntityHealthBreakdown = {
  total: number;
  buckets: StatusBreakdownBucket[];
};

export type TodayStateMeters = {
  /** EM負荷: 朝キュー全件数 / ソフト上限（判断+観測+整備1）。超過しても current は実数のまま。 */
  emLoad: { current: number; max: number };
  /** 組織健全度（良/注/危の加重平均％）。材料が無ければ null */
  orgHealthPercent: number | null;
  /** 1on1カバレッジ％ */
  oneOnOneCoveragePercent: number | null;
  oneOnOneCoverage: { covered: number; total: number };
  teamHealth: EntityHealthBreakdown;
  personHealth: EntityHealthBreakdown;
  weeklyTone: WeeklyJournalTonePoint[];
  /** 注目チップ（状態が warn/bad のチーム・メンバー先頭） */
  attentionChips: SituationItem[];
};

function pushBucket(
  map: Map<VitalStatus, { count: number; examples: string[] }>,
  status: VitalStatus,
  name: string,
) {
  const cur = map.get(status) ?? { count: 0, examples: [] };
  cur.count += 1;
  if (cur.examples.length < 2) cur.examples.push(name);
  map.set(status, cur);
}

function toBreakdown(map: Map<VitalStatus, { count: number; examples: string[] }>): EntityHealthBreakdown {
  const order: VitalStatus[] = ["good", "warn", "bad", "unknown"];
  const buckets: StatusBreakdownBucket[] = [];
  let total = 0;
  for (const status of order) {
    const row = map.get(status);
    if (!row || row.count === 0) continue;
    total += row.count;
    buckets.push({ status, count: row.count, examples: row.examples });
  }
  return { total, buckets };
}

function weightedHealthPercent(statuses: VitalStatus[]): number | null {
  let sum = 0;
  let n = 0;
  for (const s of statuses) {
    const w = STATUS_WEIGHT[s];
    if (w === null) continue;
    sum += w;
    n += 1;
  }
  if (n === 0) return null;
  return Math.round(sum / n);
}

export type BuildTodayStateMetersParams = {
  now: number;
  journalEntries: JournalEntry[];
  vitals: OrgVitals;
  people: PersonSummary[];
  nextActions: NextAction[];
  decisionQueueLimit: number;
  observationQueueLimit: number;
  push: (path: string) => void;
  prefillJournal: (text: string) => void;
};

export function buildTodayStateMeters(params: BuildTodayStateMetersParams): TodayStateMeters {
  const {
    now,
    journalEntries,
    vitals,
    people: allPeople,
    nextActions,
    decisionQueueLimit,
    observationQueueLimit,
    push,
    prefillJournal,
  } = params;
  const people = allPeople.filter((p) => p.isDirectReport);

  // ソフト上限 = 判断待ち初期上限 + 観測不足初期上限 + 整備の目安1。
  // 表示用の目安であり、current は nextActions の実数（キャップしない）。
  const softMax = Math.max(1, decisionQueueLimit + observationQueueLimit + 1);
  const loadCurrent = nextActions.length;

  const teamMap = new Map<VitalStatus, { count: number; examples: string[] }>();
  const personMap = new Map<VitalStatus, { count: number; examples: string[] }>();
  const scored: VitalStatus[] = [];

  for (const t of vitals.teams) {
    pushBucket(teamMap, t.status, t.teamName);
    scored.push(t.status);
  }
  // 1on1 Coverage は組織指標でありチームではないため、チーム内訳には入れない。
  // 健全度％にも混ぜず、専用 dial / 注目チップ側で見せる。

  for (const p of people) {
    const status = personVitalStatus(p.trend, p.hasConcerningSuggestion);
    pushBucket(personMap, status, p.name);
    scored.push(status);
  }

  const coverageTotal = vitals.oneOnOneCoverage.total;
  const coveragePercent =
    coverageTotal > 0 ? Math.round((vitals.oneOnOneCoverage.covered / coverageTotal) * 100) : null;

  const attentionChips: SituationItem[] = [];
  for (const t of vitals.teams) {
    if (t.status !== "bad" && t.status !== "warn") continue;
    attentionChips.push({
      id: `attn-team-${t.teamId}`,
      text: t.teamName,
      detail: `${t.teamName}: ${t.label}（${t.reason}）`,
      since: 0,
      status: t.status,
      entityKind: "team",
      onSelect: () => push(`/teams?focus=${t.teamId}`),
    });
  }
  if (vitals.oneOnOneCoverage.status === "bad" || vitals.oneOnOneCoverage.status === "warn") {
    const uncovered = vitals.oneOnOneCoverage.uncoveredMembers;
    attentionChips.push({
      id: "attn-coverage",
      text: "1on1 Coverage",
      detail: vitals.oneOnOneCoverage.reason,
      since: 0,
      status: vitals.oneOnOneCoverage.status,
      onSelect: () => prefillJournal(uncovered[0] ? `#1on1 @${uncovered[0]} ` : ""),
    });
  }
  for (const p of people) {
    const status = personVitalStatus(p.trend, p.hasConcerningSuggestion);
    if (status !== "bad" && status !== "warn") continue;
    attentionChips.push({
      id: `attn-person-${p.id}`,
      text: p.name,
      detail: `${p.name}: ${PERSON_VITAL_LABEL[status]}`,
      since: 0,
      status,
      entityKind: "person",
      onSelect: () => push(`/people/${p.id}`),
    });
  }

  return {
    emLoad: { current: loadCurrent, max: softMax },
    orgHealthPercent: weightedHealthPercent(scored),
    oneOnOneCoveragePercent: coveragePercent,
    oneOnOneCoverage: {
      covered: vitals.oneOnOneCoverage.covered,
      total: vitals.oneOnOneCoverage.total,
    },
    teamHealth: toBreakdown(teamMap),
    personHealth: toBreakdown(personMap),
    weeklyTone: buildWeeklyJournalToneTrend(journalEntries, 4, now),
    attentionChips: attentionChips.slice(0, 6),
  };
}

export function formatElapsedLabel(since: number, now: number): string {
  if (!since) return "";
  const days = Math.max(0, Math.floor((now - since) / (24 * 60 * 60 * 1000)));
  if (days <= 0) return "今日";
  return `${days}日`;
}

export function elapsedDays(since: number, now: number): number {
  if (!since) return 0;
  return Math.max(0, Math.floor((now - since) / (24 * 60 * 60 * 1000)));
}

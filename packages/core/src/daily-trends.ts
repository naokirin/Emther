// 改修依頼「ふりかえりタブで日毎の変化をグラフで見たい」「先週・先月など時間を自由に
// 移動したい」対応。EM自身のバイタル（チェックイン）と、Journal/Issueの日毎の件数を、
// 既存の生データ（useEmCheckins / useJournal / useIssues が返す全件リスト）から
// 週／月カレンダーに揃えた期間で集計するだけの純粋関数群。新しい永続化エンティティは
// 持たず、既存データを画面側で読みやすい形に畳むだけ（groupNotesByWeekと同じ考え方）。
import type { EmCheckin, Issue, JournalEntry } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateKeyOf(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayLabelOf(dateKey: string): string {
  const [, m, d] = dateKey.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// [start, end) の半開区間で日付キーを古い→新しい順に返す。記録が無い日も含めることで、
// 「この日は記録が少なくなっている」という抜けそのものをグラフ上に表現できる。
export type DateWindow = { start: number; end: number };

function dateKeysInWindow(window: DateWindow): string[] {
  const keys: string[] = [];
  for (let t = startOfDay(window.start); t < window.end; t += DAY_MS) {
    keys.push(dateKeyOf(t));
  }
  return keys;
}

export type PeriodUnit = "week" | "month";

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// 週次振り返り（growth/page.tsxのstartOfWeekと同じ、月曜0時始まり）・月次レポートと
// カレンダー軸を揃えた期間ウィンドウ。offset=0が「今週/今月」、-1が「先週/先月」、
// +1が「来週/来月」（未来は空データになるだけで、ナビゲーション自体は妨げない）。
export function periodWindow(unit: PeriodUnit, offset: number, base = Date.now()): DateWindow & { label: string } {
  const d = new Date(base);
  if (unit === "week") {
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday + offset * 7);
    monday.setHours(0, 0, 0, 0);
    const start = monday.getTime();
    const end = start + 7 * DAY_MS;
    return { start, end, label: `${formatDate(start)} 〜 ${formatDate(end - DAY_MS)}` };
  }
  const monthStart = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  monthStart.setHours(0, 0, 0, 0);
  const start = monthStart.getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + offset + 1, 1).getTime();
  return { start, end, label: `${monthStart.getFullYear()}年${monthStart.getMonth() + 1}月` };
}

export type CheckinDailyPoint = {
  dateKey: string;
  label: string;
  mood: number | null;
  energy: number | null;
  stress: number | null;
  count: number;
};

// 1日に複数回チェックインした場合は平均する。記録が無い日はnull（折れ線を繋げず途切れさせる）。
export function buildCheckinDailyTrend(checkins: EmCheckin[], window: DateWindow): CheckinDailyPoint[] {
  const byDay = new Map<string, { mood: number; energy: number; stress: number; count: number }>();
  for (const c of checkins) {
    if (c.createdAt < window.start || c.createdAt >= window.end) continue;
    const key = dateKeyOf(c.createdAt);
    const agg = byDay.get(key) ?? { mood: 0, energy: 0, stress: 0, count: 0 };
    agg.mood += c.mood;
    agg.energy += c.energy;
    agg.stress += c.stress;
    agg.count += 1;
    byDay.set(key, agg);
  }
  return dateKeysInWindow(window).map((key) => {
    const agg = byDay.get(key);
    return {
      dateKey: key,
      label: dayLabelOf(key),
      mood: agg ? agg.mood / agg.count : null,
      energy: agg ? agg.energy / agg.count : null,
      stress: agg ? agg.stress / agg.count : null,
      count: agg?.count ?? 0,
    };
  });
}

export type JournalIssueDailyPoint = {
  dateKey: string;
  label: string;
  journalPositive: number;
  journalNeutral: number;
  journalNegative: number;
  journalTotal: number;
  issueCreated: number;
};

// Journalはsentiment別の件数、Issueは起票日ベースの件数を日毎に積む。
// 「ネガティブ・ポジティブが多い/少ない」はJournal側、「業務状況」の量感はIssue側で見る。
// docs/2nd_pivot_version.md Phase 5対応。issueDone（doneAtベースの日次解決件数）は、
// Phase 2.4でstatus編集UI自体が廃止されdoneAtが書き込めなくなったため削除した。
export function buildJournalIssueDailyTrend(
  journalEntries: JournalEntry[],
  issues: Issue[],
  window: DateWindow,
): JournalIssueDailyPoint[] {
  const journalByDay = new Map<string, { positive: number; neutral: number; negative: number }>();
  for (const e of journalEntries) {
    if (e.createdAt < window.start || e.createdAt >= window.end) continue;
    const key = dateKeyOf(e.createdAt);
    const agg = journalByDay.get(key) ?? { positive: 0, neutral: 0, negative: 0 };
    agg[e.sentiment] += 1;
    journalByDay.set(key, agg);
  }
  const createdByDay = new Map<string, number>();
  for (const issue of issues) {
    if (issue.createdAt >= window.start && issue.createdAt < window.end) {
      const createdKey = dateKeyOf(issue.createdAt);
      createdByDay.set(createdKey, (createdByDay.get(createdKey) ?? 0) + 1);
    }
  }
  return dateKeysInWindow(window).map((key) => {
    const j = journalByDay.get(key);
    return {
      dateKey: key,
      label: dayLabelOf(key),
      journalPositive: j?.positive ?? 0,
      journalNeutral: j?.neutral ?? 0,
      journalNegative: j?.negative ?? 0,
      journalTotal: (j?.positive ?? 0) + (j?.neutral ?? 0) + (j?.negative ?? 0),
      issueCreated: createdByDay.get(key) ?? 0,
    };
  });
}

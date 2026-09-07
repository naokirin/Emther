import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { listEvents, type KnowledgeEntityType } from "@/lib/knowledge-store";
import { listIssues } from "@/lib/issue-store";
import { listJournalEntries } from "@/lib/journal-store";
import { maskForStorage, unmaskNames } from "@/lib/people-directory";
import { charterFilledCount } from "@/lib/types";

// docs/memo.md TODO「Quick Journal、Issue進捗、各種イベントを週次・月次でレポーティングする
// 機能を追加する。レポートを一過性とせず、蓄積して過去のものも参照できるようにする」対応。
// Team Vitals（vitals.ts）と同じく「感覚」ではなく既存の観測データ（Journal/Issue/変更履歴）
// から機械的に集計するだけで、新しい判定ロジック（LLMによる要約等）は導入しない。
// 生成した瞬間の集計結果をスナップショットとしてSQLiteへ保存し、後から過去のレポートを
// そのまま参照できるようにする（生成後に再計算すると、Issueのアーカイブ等で数字が
// 変わってしまうため）。

export type ReportPeriodType = "week" | "month";

const PERIOD_DAYS: Record<ReportPeriodType, number> = { week: 7, month: 30 };

export type ReportJournalStats = {
  total: number;
  byUrgency: { low: number; mid: number; high: number };
  bySentiment: { positive: number; negative: number; neutral: number };
  topTags: { tag: string; count: number }[];
  // 緊急度high、またはネガティブなエントリを「後で見返す価値が高いもの」として抜粋する。
  notableEntries: { id: string; summary: string; urgency: string; sentiment: string; occurredAt: number }[];
};

export type ReportIssueStats = {
  createdCount: number;
  archivedCount: number;
  // 現在時点のスナップショット（期間で絞らない）。Dashboardの「Issue未整理」と同じ定義。
  openIncompleteCount: number;
  createdTitles: { id: string; title: string }[];
  archivedTitles: { id: string; title: string }[];
};

export type ReportEventStats = {
  total: number;
  byEntityType: Partial<Record<KnowledgeEntityType, number>>;
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

type Row = {
  id: string;
  period_type: string;
  period_start: number;
  period_end: number;
  generated_at: number;
  stats_json: string;
  note: string;
};

function rowToReport(row: Row): Report {
  return {
    id: row.id,
    periodType: row.period_type as ReportPeriodType,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    generatedAt: row.generated_at,
    stats: JSON.parse(row.stats_json) as ReportStats,
    note: row.note,
  };
}

function computeJournalStats(periodStart: number, periodEnd: number): ReportJournalStats {
  const entries = listJournalEntries().filter((e) => e.createdAt >= periodStart && e.createdAt < periodEnd);

  const tagCounts = new Map<string, number>();
  for (const e of entries) {
    for (const tag of e.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  const notableEntries = entries
    .filter((e) => e.urgency === "high" || e.sentiment === "negative")
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5)
    .map((e) => ({
      id: e.id,
      summary: e.summary || e.rawText,
      urgency: e.urgency,
      sentiment: e.sentiment,
      occurredAt: e.createdAt,
    }));

  return {
    total: entries.length,
    byUrgency: {
      low: entries.filter((e) => e.urgency === "low").length,
      mid: entries.filter((e) => e.urgency === "mid").length,
      high: entries.filter((e) => e.urgency === "high").length,
    },
    bySentiment: {
      positive: entries.filter((e) => e.sentiment === "positive").length,
      negative: entries.filter((e) => e.sentiment === "negative").length,
      neutral: entries.filter((e) => e.sentiment === "neutral").length,
    },
    topTags,
    notableEntries,
  };
}

function computeIssueStats(periodStart: number, periodEnd: number): ReportIssueStats {
  const issues = listIssues();
  const created = issues.filter((i) => i.createdAt >= periodStart && i.createdAt < periodEnd);
  const archived = issues.filter((i) => i.archivedAt && i.archivedAt >= periodStart && i.archivedAt < periodEnd);
  // Dashboardの「Issue未整理」（issueNeedsCharter）と同じ定義。期間ではなく現在の状態。
  const openIncomplete = issues.filter((i) => !i.parentId && !i.archived && charterFilledCount(i.charter) < 3);

  return {
    createdCount: created.length,
    archivedCount: archived.length,
    openIncompleteCount: openIncomplete.length,
    createdTitles: created.slice(0, 10).map((i) => ({ id: i.id, title: i.title })),
    archivedTitles: archived.slice(0, 10).map((i) => ({ id: i.id, title: i.title })),
  };
}

function computeEventStats(periodStart: number, periodEnd: number): ReportEventStats {
  // Journal（context: "observation"）は別枠で集計済みのため、ここでは「組織の状態そのものの
  // 変更」（Timeline機能と同じcontext:"official"）だけを対象にする。
  const events = listEvents({ kind: "fact" }).filter(
    (e) => e.context === "official" && e.occurredAt >= periodStart && e.occurredAt < periodEnd,
  );
  const byEntityType: Partial<Record<KnowledgeEntityType, number>> = {};
  for (const e of events) {
    byEntityType[e.entityType] = (byEntityType[e.entityType] ?? 0) + 1;
  }
  return { total: events.length, byEntityType };
}

export function generateReport(periodType: ReportPeriodType, now = Date.now()): Report {
  const periodEnd = now;
  const periodStart = periodEnd - PERIOD_DAYS[periodType] * 24 * 60 * 60 * 1000;
  const stats: ReportStats = {
    journal: computeJournalStats(periodStart, periodEnd),
    issues: computeIssueStats(periodStart, periodEnd),
    events: computeEventStats(periodStart, periodEnd),
  };

  const report: Report = {
    id: randomUUID(),
    periodType,
    periodStart,
    periodEnd,
    generatedAt: now,
    stats,
    note: "",
  };

  getDb()
    .prepare(
      `INSERT INTO reports (id, period_type, period_start, period_end, generated_at, stats_json, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(report.id, report.periodType, report.periodStart, report.periodEnd, report.generatedAt, JSON.stringify(report.stats), report.note);

  return report;
}

export function listReports(periodType?: ReportPeriodType): Report[] {
  const where = periodType ? "WHERE period_type = ?" : "";
  const params = periodType ? [periodType] : [];
  const rows = getDb()
    .prepare(`SELECT * FROM reports ${where} ORDER BY period_end DESC`)
    .all(...params) as unknown as Row[];
  return rows.map(rowToReport);
}

export function getReport(id: string): Report | undefined {
  const row = getDb().prepare("SELECT * FROM reports WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToReport(row) : undefined;
}

export async function updateReportNote(id: string, note: string): Promise<Report | undefined> {
  const report = getReport(id);
  if (!report) return undefined;
  const masked = note.trim() ? await maskForStorage(note.trim()) : "";
  getDb().prepare("UPDATE reports SET note = ? WHERE id = ?").run(masked, id);
  return { ...report, note: masked };
}

// 個人情報の分離（ユーザー指摘対応）: 上記の関数群はマスクされたテキストを返す内部表現。
// EM向けのAPI応答を組み立てる境界だけで、この関数を通して実名へ復元する
// （他のtoXxxView()と同じ設計方針）。
export function toReportView(report: Report): Report {
  return {
    ...report,
    stats: {
      ...report.stats,
      journal: {
        ...report.stats.journal,
        topTags: report.stats.journal.topTags.map((t) => ({ ...t, tag: unmaskNames(t.tag) })),
        notableEntries: report.stats.journal.notableEntries.map((e) => ({ ...e, summary: unmaskNames(e.summary) })),
      },
      issues: {
        ...report.stats.issues,
        createdTitles: report.stats.issues.createdTitles.map((i) => ({ ...i, title: unmaskNames(i.title) })),
        archivedTitles: report.stats.issues.archivedTitles.map((i) => ({ ...i, title: unmaskNames(i.title) })),
      },
    },
    note: unmaskNames(report.note),
  };
}

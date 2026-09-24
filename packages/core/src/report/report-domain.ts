import { randomUUID } from "node:crypto";
import { listEvents, type KnowledgeEntityType } from "../knowledge-store";
import { listSuggestions } from "../suggestion-store";
import { listJournalEntries } from "../journal-store";
import { maskForStorage, unmaskNames } from "../people-directory";
import type {
  Report,
  ReportEventStats,
  ReportJournalStats,
  ReportPeriodType,
  ReportRepository,
  ReportStats,
  ReportSuggestionStats,
} from "./report-types";
import { PERIOD_DAYS } from "./report-types";

export type {
  Report,
  ReportEventStats,
  ReportJournalStats,
  ReportPeriodType,
  ReportStats,
  ReportSuggestionStats,
} from "./report-types";
export { PERIOD_DAYS } from "./report-types";

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
    .filter((e) => (e.urgency === "high" || e.sentiment === "negative") && !e.noActionNeededAt)
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

function computeSuggestionStats(periodStart: number, periodEnd: number): ReportSuggestionStats {
  const suggestions = listSuggestions();
  const created = suggestions.filter((s) => s.createdAt >= periodStart && s.createdAt < periodEnd);
  const archived = suggestions.filter((s) => s.archivedAt && s.archivedAt >= periodStart && s.archivedAt < periodEnd);

  return {
    createdCount: created.length,
    archivedCount: archived.length,
    createdTitles: created.slice(0, 10).map((s) => ({ id: s.id, title: s.title })),
    archivedTitles: archived.slice(0, 10).map((s) => ({ id: s.id, title: s.title })),
  };
}

function computeEventStats(periodStart: number, periodEnd: number): ReportEventStats {
  const events = listEvents({ kind: "fact" }).filter(
    (e) => e.context === "official" && e.occurredAt >= periodStart && e.occurredAt < periodEnd,
  );
  const byEntityType: Partial<Record<KnowledgeEntityType, number>> = {};
  for (const e of events) {
    byEntityType[e.entityType] = (byEntityType[e.entityType] ?? 0) + 1;
  }
  return { total: events.length, byEntityType };
}

export function createReportService(repo: ReportRepository) {
  function computeReportStats(periodStart: number, periodEnd: number): ReportStats {
    return {
      journal: computeJournalStats(periodStart, periodEnd),
      suggestions: computeSuggestionStats(periodStart, periodEnd),
      events: computeEventStats(periodStart, periodEnd),
    };
  }

  function generateReportForWindow(
    periodType: ReportPeriodType,
    periodStart: number,
    periodEnd: number,
    now = Date.now(),
  ): Report {
    const stats = computeReportStats(periodStart, periodEnd);
    const report: Report = {
      id: randomUUID(),
      periodType,
      periodStart,
      periodEnd,
      generatedAt: now,
      stats,
      note: "",
    };
    repo.insert(report);
    return report;
  }

  function generateReport(periodType: ReportPeriodType, now = Date.now()): Report {
    const periodEnd = now;
    const periodStart = periodEnd - PERIOD_DAYS[periodType] * 24 * 60 * 60 * 1000;
    return generateReportForWindow(periodType, periodStart, periodEnd, now);
  }

  function listReports(periodType?: ReportPeriodType): Report[] {
    return repo.list(periodType);
  }

  function getReport(id: string): Report | undefined {
    return repo.get(id);
  }

  async function updateReportNote(id: string, note: string): Promise<Report | undefined> {
    const report = getReport(id);
    if (!report) return undefined;
    const masked = note.trim() ? await maskForStorage(note.trim()) : "";
    repo.updateNote(id, masked);
    return { ...report, note: masked };
  }

  function toReportView(report: Report): Report {
    return {
      ...report,
      stats: {
        ...report.stats,
        journal: {
          ...report.stats.journal,
          topTags: report.stats.journal.topTags.map((t) => ({ ...t, tag: unmaskNames(t.tag) })),
          notableEntries: report.stats.journal.notableEntries.map((e) => ({
            ...e,
            summary: unmaskNames(e.summary),
          })),
        },
        suggestions: {
          ...report.stats.suggestions,
          createdTitles: report.stats.suggestions.createdTitles.map((s) => ({
            ...s,
            title: unmaskNames(s.title),
          })),
          archivedTitles: report.stats.suggestions.archivedTitles.map((s) => ({
            ...s,
            title: unmaskNames(s.title),
          })),
        },
      },
      note: unmaskNames(report.note),
    };
  }

  return {
    computeReportStats,
    generateReportForWindow,
    generateReport,
    listReports,
    getReport,
    updateReportNote,
    toReportView,
  };
}

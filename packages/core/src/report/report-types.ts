import type { KnowledgeEntityType } from "../knowledge-store";

export type ReportPeriodType = "week" | "month";

export const PERIOD_DAYS: Record<ReportPeriodType, number> = { week: 7, month: 30 };

export type ReportJournalStats = {
  total: number;
  byUrgency: { low: number; mid: number; high: number };
  bySentiment: { positive: number; negative: number; neutral: number };
  topTags: { tag: string; count: number }[];
  notableEntries: { id: string; summary: string; urgency: string; sentiment: string; occurredAt: number }[];
};

export type ReportSuggestionStats = {
  createdCount: number;
  archivedCount: number;
  createdTitles: { id: string; title: string }[];
  archivedTitles: { id: string; title: string }[];
};

export type ReportEventStats = {
  total: number;
  byEntityType: Partial<Record<KnowledgeEntityType, number>>;
};

export type ReportStats = {
  journal: ReportJournalStats;
  suggestions: ReportSuggestionStats;
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

export type ReportRepository = {
  insert(report: Report): void;
  list(periodType?: ReportPeriodType): Report[];
  get(id: string): Report | undefined;
  updateNote(id: string, note: string): void;
};

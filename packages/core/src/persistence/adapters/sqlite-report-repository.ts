import type { Report, ReportPeriodType, ReportRepository, ReportStats } from "../../report/report-types";
import { createSqliteExecutor, type SqliteExecutor } from "../sqlite-executor";

type Row = {
  id: string;
  period_type: string;
  period_start: number;
  period_end: number;
  generated_at: number;
  stats_json: string;
  note: string;
};

function normalizeReportStats(raw: unknown): ReportStats {
  const stats = raw as ReportStats & { issues?: ReportStats["suggestions"] };
  if (!stats.suggestions && stats.issues) {
    return { ...stats, suggestions: stats.issues };
  }
  return stats;
}

function rowToReport(row: Row): Report {
  return {
    id: row.id,
    periodType: row.period_type as ReportPeriodType,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    generatedAt: row.generated_at,
    stats: normalizeReportStats(JSON.parse(row.stats_json)),
    note: row.note,
  };
}

export function createSqliteReportRepository(
  db: SqliteExecutor = createSqliteExecutor(),
): ReportRepository {
  return {
    insert(report: Report): void {
      db.run(
        `INSERT INTO reports (id, period_type, period_start, period_end, generated_at, stats_json, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        report.id,
        report.periodType,
        report.periodStart,
        report.periodEnd,
        report.generatedAt,
        JSON.stringify(report.stats),
        report.note,
      );
    },
    list(periodType?: ReportPeriodType): Report[] {
      if (periodType) {
        return db
          .all<Row>(`SELECT * FROM reports WHERE period_type = ? ORDER BY period_end DESC`, periodType)
          .map(rowToReport);
      }
      return db.all<Row>(`SELECT * FROM reports ORDER BY period_end DESC`).map(rowToReport);
    },
    get(id: string): Report | undefined {
      const row = db.get<Row>("SELECT * FROM reports WHERE id = ?", id);
      return row ? rowToReport(row) : undefined;
    },
    updateNote(id: string, note: string): void {
      db.run("UPDATE reports SET note = ? WHERE id = ?", note, id);
    },
  };
}

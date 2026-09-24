import { createReportService } from "./report/report-domain";
import { createSqliteReportRepository } from "./persistence/adapters/sqlite-report-repository";

export type {
  Report,
  ReportEventStats,
  ReportJournalStats,
  ReportPeriodType,
  ReportStats,
  ReportSuggestionStats,
} from "./report/report-types";
export { PERIOD_DAYS } from "./report/report-types";

const service = createReportService(createSqliteReportRepository());

export const computeReportStats = service.computeReportStats;
export const generateReportForWindow = service.generateReportForWindow;
export const generateReport = service.generateReport;
export const listReports = service.listReports;
export const getReport = service.getReport;
export const updateReportNote = service.updateReportNote;
export const toReportView = service.toReportView;

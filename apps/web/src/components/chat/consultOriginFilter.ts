import type { AgentRun } from "@emther/core/agent-runtime";
import type { ConsultOriginFilter } from "@/router";

export const CONSULT_ORIGIN_FILTER_LABELS: Record<ConsultOriginFilter, string> = {
  all: "すべて",
  manual: "直接相談",
  "auto-summary": "朝のサマリー",
  "auto-distill": "状況蒸留",
  journal: "Journal分析",
  "auto-grow": "学びの提案",
  report: "週次・月次",
};

export function matchesConsultOriginFilter(
  run: Pick<AgentRun, "origin">,
  filter: ConsultOriginFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "manual":
      return run.origin === "manual";
    case "auto-summary":
      return run.origin === "auto-summary";
    case "auto-distill":
      return run.origin === "auto-distill";
    case "journal":
      return run.origin === "auto-anomaly" || run.origin === "auto-journal-batch";
    case "auto-grow":
      return run.origin === "auto-grow";
    case "report":
      return run.origin === "auto-weekly-report" || run.origin === "auto-monthly-report";
    default:
      return true;
  }
}

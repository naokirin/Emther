// Journal → 相談 → Issue の生成元を、画面とフォールバック判定で同じ規則に揃える。
// ストアには依存せず、保存済みの ID / task 文字列だけを見る。

export const ISSUE_DRAFT_TASK_PREFIX = "新しいIssueが起票されました";
export const JOURNAL_ENTRY_TASK_MARKER = '対象のJournalエントリ: "';

export function journalExcerptFromTask(task: string): string | undefined {
  const idx = task.indexOf(JOURNAL_ENTRY_TASK_MARKER);
  if (idx < 0) return undefined;
  const rest = task.slice(idx + JOURNAL_ENTRY_TASK_MARKER.length);
  const end = rest.lastIndexOf('"');
  const excerpt = (end >= 0 ? rest.slice(0, end) : rest).trim();
  return excerpt || undefined;
}

export function isIssueDraftAnalysisTask(task: string): boolean {
  return task.startsWith(ISSUE_DRAFT_TASK_PREFIX);
}

export function consultExcerpt(task: string): string {
  return journalExcerptFromTask(task) ?? task.trim();
}

export function truncateExcerpt(text: string, maxLength = 160): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

// Issueの現在の agentRunId は更新分析で上書きされるため、生成時に残した sourceRunId を優先する。
// 旧データは「起票直後の分析Runでも Issue更新分析でもない」linked run を相談元とみなす。
export function resolveSourceConsultRun<T extends { id: string; task: string; origin: string }>(
  issue: { sourceRunId?: string; agentRunId?: string },
  runs: T[],
): T | undefined {
  if (issue.sourceRunId) return runs.find((r) => r.id === issue.sourceRunId);
  const linked = issue.agentRunId ? runs.find((r) => r.id === issue.agentRunId) : undefined;
  if (!linked) return undefined;
  if (linked.origin === "auto-issue-update") return undefined;
  if (isIssueDraftAnalysisTask(linked.task)) return undefined;
  return linked;
}

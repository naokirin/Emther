import type { ConfirmPriority } from "../types";

/** 移行専用の旧 Issue レコード形。 */
export type LegacyIssueRecord = {
  id: string;
  title: string;
  agentRunId?: string;
  sourceRunId?: string;
  sourceJournalId?: string;
  charter?: { why?: string; what?: string; how?: string };
  logEntries?: { id: string; text: string; createdAt: number }[];
  parentId?: string;
  status?: string;
  priority?: ConfirmPriority;
  focusOrder?: number;
  archived?: boolean;
  archivedAt?: number;
  themeId?: string;
  teamId?: string;
  embedding?: number[];
  createdAt: number;
  updatedAt: number;
};

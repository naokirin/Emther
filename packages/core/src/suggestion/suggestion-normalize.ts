import { randomUUID } from "node:crypto";
import { CONFIRM_PRIORITIES, SUGGESTION_REVIEW_STATUSES } from "../types";
import type {
  ConfirmPriority,
  Suggestion,
  SuggestionMemo,
  SuggestionMemoSource,
  SuggestionReviewStatus,
} from "../types";
import type { LegacyIssueRecord } from "./suggestion-legacy";

const SUGGESTION_MEMO_SOURCES: SuggestionMemoSource[] = ["user", "agent"];

function normalizeMemoSource(raw: unknown): SuggestionMemoSource | undefined {
  return typeof raw === "string" && SUGGESTION_MEMO_SOURCES.includes(raw as SuggestionMemoSource)
    ? (raw as SuggestionMemoSource)
    : undefined;
}

export function migrateLegacyIssueToSuggestion(raw: LegacyIssueRecord): Suggestion {
  const memos: SuggestionMemo[] = (raw.logEntries ?? []).map((l) => ({
    id: l.id,
    text: l.text,
    createdAt: l.createdAt,
  }));

  const why = raw.charter?.why?.trim() ?? "";
  const what = raw.charter?.what?.trim() ?? "";
  const how = raw.charter?.how?.trim() ?? "";
  if (why || what || how) {
    const parts = [
      why ? `Why: ${why}` : "",
      what ? `What: ${what}` : "",
      how ? `How: ${how}` : "",
    ].filter(Boolean);
    memos.unshift({
      id: randomUUID(),
      text: `（旧 Why/What/How）\n${parts.join("\n")}`,
      createdAt: raw.createdAt,
      source: "agent",
    });
  }

  const done = raw.archived === true || raw.status === "done";
  const confirmPriority: ConfirmPriority =
    raw.priority && CONFIRM_PRIORITIES.includes(raw.priority) ? raw.priority : "normal";

  return {
    id: raw.id,
    title: raw.title,
    reviewStatus: done ? "done" : "unreviewed",
    confirmPriority,
    focusOrder: confirmPriority === "focus" ? (raw.focusOrder ?? 0) : undefined,
    memos,
    agentRunId: raw.agentRunId,
    sourceRunId: raw.sourceRunId,
    sourceJournalId: raw.sourceJournalId,
    teamId: raw.teamId,
    themeId: raw.themeId,
    embedding: raw.embedding,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    reviewedAt: done ? (raw.archivedAt ?? raw.updatedAt) : undefined,
  };
}

export function normalizeSuggestion(raw: Suggestion): Suggestion {
  const reviewStatus: SuggestionReviewStatus = SUGGESTION_REVIEW_STATUSES.includes(raw.reviewStatus)
    ? raw.reviewStatus
    : "unreviewed";
  const confirmPriority: ConfirmPriority = CONFIRM_PRIORITIES.includes(raw.confirmPriority)
    ? raw.confirmPriority
    : "normal";
  const memos = (raw.memos ?? []).map((m) => {
    const source = normalizeMemoSource(m.source);
    return source ? { ...m, source } : { ...m, source: undefined };
  });
  return {
    ...raw,
    reviewStatus,
    confirmPriority,
    memos,
    focusOrder: confirmPriority === "focus" ? (raw.focusOrder ?? 0) : undefined,
  };
}

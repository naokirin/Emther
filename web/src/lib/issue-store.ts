import {
  addMemo,
  createSuggestion,
  getSuggestion,
  getSuggestionByRunId,
  linkSuggestionRun,
  listSuggestions,
  moveFocusSuggestion,
  persistSuggestionEmbedding,
  refreshSuggestionEmbedding,
  setConfirmPriority,
  setReviewStatus,
  setSuggestionKeyResult,
  setSuggestionTeam,
  setSuggestionTheme,
  setSuggestionTitle,
  toSuggestionView,
} from "@/lib/suggestion-store";
import type { MaskOptions } from "@/lib/name-candidate-confirmation";
import type { ConfirmPriority, Suggestion } from "@/lib/types";
import type { Issue, IssueCharter, IssuePriority, IssueStatus } from "@/lib/issue-store-types";

// docs/2nd_pivot_version.md Phase 7 移行期の互換レイヤー。
// 実体は suggestion-store。旧 Issue API／agent-runtime／周辺モジュールが切替完了するまで維持する。

export type {
  ActionItem,
  Issue,
  IssueCharter,
  IssueLogEntry,
  IssuePriority,
  IssueStatus,
  IssueTriageScores,
  IssueTriageSource,
} from "@/lib/issue-store-types";

function emptyCharter(): IssueCharter {
  return { why: "", what: "", how: "" };
}

export function suggestionToLegacyIssue(s: Suggestion): Issue {
  const done = s.reviewStatus === "done";
  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。旧Issue側の
  // archived/archivedAtは「AI/Vitals等が判断材料から除外すべきか」の唯一の判定軸として
  // 各所（vitals.ts・related-context.ts・dashboard-next-actions.ts等）から直接参照されている
  // ため、"確認済み（done）" と "明示アーカイブ（重複・誤操作等での削除）" の両方をここで
  // 合流させる。s.archivedAtが立っていれば、reviewStatusに関わらずarchived扱いにする。
  const archived = done || Boolean(s.archivedAt);
  return {
    id: s.id,
    title: s.title,
    agentRunId: s.agentRunId,
    sourceRunId: s.sourceRunId,
    sourceJournalId: s.sourceJournalId,
    charter: emptyCharter(),
    actionItems: [],
    logEntries: s.memos.map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt })),
    status: done ? "done" : s.reviewStatus === "deferred" ? "blocked" : "in_progress",
    priority: s.confirmPriority,
    focusOrder: s.focusOrder,
    archived,
    archivedAt: s.archivedAt ?? (done ? s.reviewedAt : undefined),
    doneAt: done ? s.reviewedAt : undefined,
    tags: [],
    keyResultId: s.keyResultId,
    themeId: s.themeId,
    teamId: s.teamId,
    embedding: s.embedding,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function toIssueView(issue: Issue): Issue {
  const s = getSuggestion(issue.id);
  if (!s) return issue;
  return suggestionToLegacyIssue(toSuggestionView(s));
}

export function listIssues(): Issue[] {
  return listSuggestions().map(suggestionToLegacyIssue);
}

export function getIssue(id: string): Issue | undefined {
  const s = getSuggestion(id);
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export function getIssueByRunId(agentRunId: string): Issue | undefined {
  const s = getSuggestionByRunId(agentRunId);
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export function linkIssueRun(issueId: string, agentRunId: string): Issue | undefined {
  const s = linkSuggestionRun(issueId, agentRunId);
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export function listChildIssues(parentId: string): Issue[] {
  void parentId;
  return [];
}

export function persistIssueEmbedding(issueId: string, embedding: number[]): Issue | undefined {
  const s = persistSuggestionEmbedding(issueId, embedding);
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export function issueEmbedSource(issue: Pick<Issue, "title" | "charter" | "tags">): string {
  return issue.title;
}

export async function refreshIssueEmbedding(issueId: string): Promise<Issue | undefined> {
  await refreshSuggestionEmbedding(issueId);
  return getIssue(issueId);
}

export type IssueUpdateReactionOptions = {
  onUpdated?: (issueId: string, trigger: "charter" | "log", detail: string) => void;
};

export async function createIssue(
  title: string,
  agentRunId?: string,
  _charter?: Partial<IssueCharter>,
  parentId?: string,
  tags?: string[],
  keyResultId?: string,
  teamId?: string,
  opts: MaskOptions & {
    priority?: IssuePriority;
    sourceJournalId?: string;
    sourceRunId?: string;
    themeId?: string;
  } = {},
): Promise<Issue> {
  void parentId;
  void tags;
  const s = await createSuggestion(title, {
    ...opts,
    agentRunId,
    sourceRunId: opts.sourceRunId,
    sourceJournalId: opts.sourceJournalId,
    keyResultId,
    themeId: opts.themeId,
    teamId,
    confirmPriority: opts.priority as ConfirmPriority | undefined,
  });
  const why = _charter?.why?.trim() ?? "";
  const what = _charter?.what?.trim() ?? "";
  const how = _charter?.how?.trim() ?? "";
  if (why || what || how) {
    const parts = [why ? `Why: ${why}` : "", what ? `What: ${what}` : "", how ? `How: ${how}` : ""].filter(Boolean);
    await addMemo(s.id, `（旧 Why/What/How）\n${parts.join("\n")}`, opts);
  }
  return suggestionToLegacyIssue(getSuggestion(s.id) ?? s);
}

export async function updateIssueCharter(
  issueId: string,
  patch: Partial<IssueCharter>,
  opts: MaskOptions & IssueUpdateReactionOptions = {},
): Promise<Issue | undefined> {
  const parts = (["why", "what", "how"] as const)
    .filter((k) => patch[k] !== undefined && patch[k]!.trim())
    .map((k) => `${k === "why" ? "Why" : k === "what" ? "What" : "How"}: ${patch[k]!.trim()}`);
  if (parts.length === 0) return getIssue(issueId);
  const s = await addMemo(issueId, `（Charter更新）\n${parts.join("\n")}`, {
    ...opts,
    onUpdated: opts.onUpdated
      ? (id, _t, detail) => opts.onUpdated?.(id, "charter", detail)
      : undefined,
  });
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export async function setIssueTitle(
  issueId: string,
  title: string,
  opts: MaskOptions = {},
): Promise<Issue | undefined> {
  const s = await setSuggestionTitle(issueId, title, opts);
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export async function addLogEntry(
  issueId: string,
  text: string,
  opts: MaskOptions & IssueUpdateReactionOptions = {},
): Promise<Issue | undefined> {
  const s = await addMemo(issueId, text, {
    ...opts,
    onUpdated: opts.onUpdated
      ? (id, _t, detail) => opts.onUpdated?.(id, "log", detail)
      : undefined,
  });
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export function setIssueStatus(issueId: string, status: IssueStatus): Issue | undefined {
  if (status === "done") {
    const s = setReviewStatus(issueId, "done");
    return s ? suggestionToLegacyIssue(s) : undefined;
  }
  if (status === "blocked") {
    const s = setReviewStatus(issueId, "deferred");
    return s ? suggestionToLegacyIssue(s) : undefined;
  }
  const s = setReviewStatus(issueId, "unreviewed");
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export function setIssuePriority(issueId: string, priority: IssuePriority): Issue | undefined {
  const s = setConfirmPriority(issueId, priority);
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export function moveFocusIssue(issueId: string, direction: "up" | "down"): Issue | undefined {
  const s = moveFocusSuggestion(issueId, direction);
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export function setIssueArchived(issueId: string, archived: boolean): Issue | undefined {
  const s = setReviewStatus(issueId, archived ? "done" : "unreviewed");
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export function setIssueKeyResult(issueId: string, keyResultId: string | null): Issue | undefined {
  const s = setSuggestionKeyResult(issueId, keyResultId);
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export function setIssueTheme(issueId: string, themeId: string | null): Issue | undefined {
  const s = setSuggestionTheme(issueId, themeId);
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export function setIssueTeam(issueId: string, teamId: string | null): Issue | undefined {
  const s = setSuggestionTeam(issueId, teamId);
  return s ? suggestionToLegacyIssue(s) : undefined;
}

export async function setIssueTags(issueId: string, tags: string[]): Promise<Issue | undefined> {
  void tags;
  return getIssue(issueId);
}

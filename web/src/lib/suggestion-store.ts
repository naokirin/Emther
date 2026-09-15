import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dataFilePath, loadJSON, peekJSON, saveJSON } from "@/lib/persistence";
import { embedText } from "@/lib/embeddings";
import { recordChangeEvent } from "@/lib/knowledge-store";
import { ensureNameCandidatesAllowed, maskForStorage, unmaskNames } from "@/lib/people-directory";
import type { MaskOptions } from "@/lib/name-candidate-confirmation";
import type {
  ConfirmPriority,
  Suggestion,
  SuggestionMemo,
  SuggestionReviewStatus,
} from "@/lib/types";

export type { Suggestion, ConfirmPriority, SuggestionReviewStatus, SuggestionMemo } from "@/lib/types";
import { CONFIRM_PRIORITIES, SUGGESTION_REVIEW_STATUSES } from "@/lib/types";

// docs/2nd_pivot_version.md Phase 7。Issue を廃し Suggestion を第一級エンティティにする。
// 既存 issues.json は suggestions.json が無い初回起動時に一度だけ移行し、以降は suggestions のみ書き込む。

/** 移行専用の旧 Issue レコード形（issue-store に依存しない）。 */
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
  keyResultId?: string;
  themeId?: string;
  teamId?: string;
  embedding?: number[];
  createdAt: number;
  updatedAt: number;
};

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
    keyResultId: raw.keyResultId,
    embedding: raw.embedding,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    reviewedAt: done ? (raw.archivedAt ?? raw.updatedAt) : undefined,
  };
}

function normalizeSuggestion(raw: Suggestion): Suggestion {
  const reviewStatus: SuggestionReviewStatus = SUGGESTION_REVIEW_STATUSES.includes(raw.reviewStatus)
    ? raw.reviewStatus
    : "unreviewed";
  const confirmPriority: ConfirmPriority = CONFIRM_PRIORITIES.includes(raw.confirmPriority)
    ? raw.confirmPriority
    : "normal";
  return {
    ...raw,
    reviewStatus,
    confirmPriority,
    memos: raw.memos ?? [],
    focusOrder: confirmPriority === "focus" ? (raw.focusOrder ?? 0) : undefined,
  };
}

function loadInitialSuggestions(): Suggestion[] {
  if (existsSync(dataFilePath("suggestions.json")) || peekJSON<Suggestion[]>("suggestions.json") !== undefined) {
    return loadJSON<Suggestion[]>("suggestions.json", []).map(normalizeSuggestion);
  }
  const legacy = loadJSON<LegacyIssueRecord[]>("issues.json", []);
  const migrated = legacy.map(migrateLegacyIssueToSuggestion);
  if (migrated.length > 0 || legacy.length === 0) {
    // 空でも suggestions.json を作り、次回以降の再移行を防ぐ。
    saveJSON("suggestions.json", migrated, { allowEmpty: true });
  }
  return migrated;
}

const suggestions: Suggestion[] = loadInitialSuggestions();

{
  const focus = suggestions
    .filter((s) => s.confirmPriority === "focus")
    .sort((a, b) => (a.focusOrder ?? 0) - (b.focusOrder ?? 0));
  focus.forEach((s, idx) => {
    s.focusOrder = idx;
  });
}

function persist(): void {
  saveJSON("suggestions.json", suggestions);
}

export function toSuggestionView(s: Suggestion): Suggestion {
  return {
    ...s,
    title: unmaskNames(s.title),
    memos: s.memos.map((m) => ({ ...m, text: unmaskNames(m.text) })),
    embedding: undefined,
  };
}

function suggestionEmbedSource(s: Pick<Suggestion, "title" | "memos">): string {
  const memoText = s.memos
    .slice(-5)
    .map((m) => unmaskNames(m.text))
    .join("\n");
  return [unmaskNames(s.title), memoText].filter(Boolean).join("\n");
}

export { suggestionEmbedSource };

export function persistSuggestionEmbedding(id: string, embedding: number[]): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s) return undefined;
  s.embedding = embedding;
  persist();
  return s;
}

export async function refreshSuggestionEmbedding(id: string): Promise<Suggestion | undefined> {
  const s = getSuggestion(id);
  if (!s) return undefined;
  try {
    const embedding = await embedText(suggestionEmbedSource(s));
    return persistSuggestionEmbedding(id, embedding);
  } catch {
    return getSuggestion(id);
  }
}

async function scheduleEmbedding(id: string): Promise<void> {
  try {
    await refreshSuggestionEmbedding(id);
  } catch {
    // 埋め込みは補助。本体保存を止めない。
  }
}

export function listSuggestions(): Suggestion[] {
  return [...suggestions].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSuggestion(id: string): Suggestion | undefined {
  return suggestions.find((s) => s.id === id);
}

export function getSuggestionByRunId(agentRunId: string): Suggestion | undefined {
  return suggestions.find((s) => s.agentRunId === agentRunId);
}

export function linkSuggestionRun(suggestionId: string, agentRunId: string): Suggestion | undefined {
  const s = getSuggestion(suggestionId);
  if (!s) return undefined;
  s.agentRunId = agentRunId;
  s.updatedAt = Date.now();
  persist();
  return s;
}

export type SuggestionUpdateReactionOptions = {
  onUpdated?: (suggestionId: string, trigger: "memo" | "title", detail: string) => void;
};

export async function createSuggestion(
  title: string,
  opts: MaskOptions & {
    agentRunId?: string;
    sourceRunId?: string;
    sourceJournalId?: string;
    keyResultId?: string;
    themeId?: string;
    teamId?: string;
    confirmPriority?: ConfirmPriority;
    id?: string;
  } = {},
): Promise<Suggestion> {
  const {
    agentRunId,
    sourceRunId,
    sourceJournalId,
    keyResultId,
    themeId,
    teamId,
    confirmPriority: requestedPriority,
    id: forcedId,
    ...maskOpts
  } = opts;
  const titleTrimmed = title.trim();
  if (!titleTrimmed) throw new Error("titleは必須です");
  await ensureNameCandidatesAllowed([titleTrimmed], maskOpts);
  const maskedTitle = await maskForStorage(titleTrimmed);
  const now = Date.now();
  const suggestion: Suggestion = {
    id: forcedId ?? randomUUID(),
    title: maskedTitle,
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    agentRunId,
    sourceRunId: sourceRunId ?? agentRunId,
    sourceJournalId,
    keyResultId,
    themeId,
    teamId,
    createdAt: now,
    updatedAt: now,
  };
  suggestions.push(suggestion);
  persist();
  recordChangeEvent("suggestion", suggestion.id, `提案を作成: 「${suggestion.title}」`);
  let result = suggestion;
  if (requestedPriority && requestedPriority !== "normal") {
    result = setConfirmPriority(suggestion.id, requestedPriority) ?? suggestion;
  }
  await scheduleEmbedding(result.id);
  return getSuggestion(result.id) ?? result;
}

export async function setSuggestionTitle(
  id: string,
  title: string,
  opts: MaskOptions & SuggestionUpdateReactionOptions = {},
): Promise<Suggestion | undefined> {
  const s = getSuggestion(id);
  if (!s) return undefined;
  const trimmed = title.trim();
  if (!trimmed) throw new Error("titleは必須です");
  if (trimmed === unmaskNames(s.title)) return s;
  await ensureNameCandidatesAllowed([trimmed], opts);
  const masked = await maskForStorage(trimmed);
  if (masked === s.title) return s;
  const previous = s.title;
  s.title = masked;
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent("suggestion", s.id, `タイトルを変更しました:「${previous}」→「${masked}」`);
  opts.onUpdated?.(s.id, "title", `タイトル: 「${unmaskNames(previous)}」→「${unmaskNames(masked)}」`);
  await scheduleEmbedding(s.id);
  return getSuggestion(s.id) ?? s;
}

export function setReviewStatus(id: string, reviewStatus: SuggestionReviewStatus): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s) return undefined;
  if (s.reviewStatus === reviewStatus) return s;
  s.reviewStatus = reviewStatus;
  s.reviewedAt = reviewStatus === "unreviewed" ? undefined : Date.now();
  s.updatedAt = Date.now();
  persist();
  const label =
    reviewStatus === "done" ? "確認済み（もう追わない）" : reviewStatus === "deferred" ? "確認保留" : "未確認";
  recordChangeEvent("suggestion", s.id, `確認状態を変更しました: ${label}`);
  return s;
}

// docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。reviewStatusは変えず、
// archivedAtだけを立てる（一覧・AIの判断材料から外すが、確認状態の履歴自体は残す）。
export function archiveSuggestion(id: string): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s) return undefined;
  if (s.archivedAt) return s;
  s.archivedAt = Date.now();
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent("suggestion", s.id, "アーカイブしました（一覧・AIの判断材料から除外）");
  return s;
}

export function unarchiveSuggestion(id: string): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s) return undefined;
  if (!s.archivedAt) return s;
  s.archivedAt = undefined;
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent("suggestion", s.id, "アーカイブを解除しました");
  return s;
}

function compactFocusOrders(): void {
  const focus = suggestions
    .filter((s) => s.confirmPriority === "focus")
    .sort((a, b) => (a.focusOrder ?? 0) - (b.focusOrder ?? 0));
  focus.forEach((s, idx) => {
    s.focusOrder = idx;
  });
}

const PRIORITY_LABEL: Record<ConfirmPriority, string> = {
  focus: "今すぐ確認",
  normal: "通常",
  parked: "後で",
};

export function setConfirmPriority(id: string, confirmPriority: ConfirmPriority): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s) return undefined;
  if (s.confirmPriority === confirmPriority) return s;
  const prev = s.confirmPriority;
  if (confirmPriority === "focus") {
    const maxOrder = Math.max(
      -1,
      ...suggestions.filter((x) => x.confirmPriority === "focus").map((x) => x.focusOrder ?? 0),
    );
    s.confirmPriority = "focus";
    s.focusOrder = maxOrder + 1;
  } else {
    s.confirmPriority = confirmPriority;
    s.focusOrder = undefined;
    if (prev === "focus") compactFocusOrders();
  }
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent("suggestion", s.id, `確認優先度を変更しました: ${PRIORITY_LABEL[confirmPriority]}`);
  return s;
}

export function moveFocusSuggestion(id: string, direction: "up" | "down"): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s || s.confirmPriority !== "focus") return undefined;
  compactFocusOrders();
  const focus = suggestions
    .filter((x) => x.confirmPriority === "focus")
    .sort((a, b) => (a.focusOrder ?? 0) - (b.focusOrder ?? 0));
  const idx = focus.findIndex((x) => x.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= focus.length) return s;
  const tmp = focus[idx].focusOrder;
  focus[idx].focusOrder = focus[swapIdx].focusOrder;
  focus[swapIdx].focusOrder = tmp;
  const now = Date.now();
  focus[idx].updatedAt = now;
  focus[swapIdx].updatedAt = now;
  persist();
  recordChangeEvent("suggestion", s.id, `確認優先の順を${direction === "up" ? "前" : "後"}へ動かしました`);
  return s;
}

export async function addMemo(
  id: string,
  text: string,
  opts: MaskOptions & SuggestionUpdateReactionOptions = {},
): Promise<Suggestion | undefined> {
  const s = getSuggestion(id);
  if (!s) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return s;
  await ensureNameCandidatesAllowed([trimmed], opts);
  const masked = await maskForStorage(trimmed);
  s.memos.push({ id: randomUUID(), text: masked, createdAt: Date.now() });
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent("suggestion", s.id, `メモを追加: 「${masked}」`);
  try {
    opts.onUpdated?.(s.id, "memo", masked);
  } catch {
    // 通知失敗で本体更新は落とさない
  }
  return s;
}

export function setSuggestionKeyResult(id: string, keyResultId: string | null): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s) return undefined;
  const next = keyResultId ?? undefined;
  if ((s.keyResultId ?? null) === (next ?? null)) return s;
  s.keyResultId = next;
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent("suggestion", s.id, next ? "Key Resultに紐付けました" : "Key Resultの紐付けを解除しました");
  return s;
}

export function setSuggestionTheme(id: string, themeId: string | null): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s) return undefined;
  const next = themeId ?? undefined;
  if ((s.themeId ?? null) === (next ?? null)) return s;
  s.themeId = next;
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent("suggestion", s.id, next ? "テーマに紐付けました" : "テーマの紐付けを解除しました");
  return s;
}

export function setSuggestionTeam(id: string, teamId: string | null): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s) return undefined;
  const next = teamId ?? undefined;
  if ((s.teamId ?? null) === (next ?? null)) return s;
  s.teamId = next;
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent("suggestion", s.id, next ? "チームに紐付けました" : "チームの紐付けを解除しました");
  return s;
}

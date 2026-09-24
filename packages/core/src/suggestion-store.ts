import { randomUUID } from "node:crypto";
import {
  mapAdviceStructuredStrings,
  normalizeAdviceStructured,
  type AdviceStructured,
} from "./advice";
import { createJsonSuggestionRepository } from "./persistence/adapters/json-suggestion-repository";
import { embedText } from "./embeddings";
import { recordChangeEvent } from "./knowledge-store";
import { ensureNameCandidatesAllowed, maskForStorage, unmaskNames } from "./people-directory";
import type { MaskOptions } from "./name-candidate-confirmation";
import type {
  ConfirmPriority,
  Suggestion,
  SuggestionCharter,
  SuggestionDetail,
  SuggestionMemo,
  SuggestionMemoSource,
  SuggestionReviewStatus,
} from "./types";
import { migrateLegacyIssueToSuggestion } from "./suggestion/suggestion-normalize";
export type { LegacyIssueRecord } from "./suggestion/suggestion-legacy";

export type { Suggestion, ConfirmPriority, SuggestionReviewStatus, SuggestionMemo, SuggestionMemoSource, SuggestionDetail } from "./types";
export { migrateLegacyIssueToSuggestion };

/** Proposal / API から detail へ載せるアドバイス欄を組み立てる。 */
export function adviceFieldsFromProposal(proposal: {
  advice?: string;
  adviceStructured?: AdviceStructured;
}): Pick<SuggestionDetail, "adviceStructured"> {
  const structured =
    proposal.adviceStructured ??
    (proposal.advice ? normalizeAdviceStructured(proposal.advice) : undefined);
  return structured ? { adviceStructured: structured } : {};
}

// docs/2nd_pivot_version.md Phase 7。Issue を廃し Suggestion を第一級エンティティにする。
// 既存 issues.json は suggestions.json が無い初回起動時に一度だけ移行し、以降は suggestions のみ書き込む。

const suggestionRepo = createJsonSuggestionRepository();
const suggestions: Suggestion[] = suggestionRepo.load();

{
  const focus = suggestions
    .filter((s) => s.confirmPriority === "focus")
    .sort((a, b) => (a.focusOrder ?? 0) - (b.focusOrder ?? 0));
  focus.forEach((s, idx) => {
    s.focusOrder = idx;
  });
}

function persist(): void {
  suggestionRepo.save(suggestions);
}

export function toSuggestionView(s: Suggestion): Suggestion {
  return {
    ...s,
    title: unmaskNames(s.title),
    memos: s.memos.map((m) => ({ ...m, text: unmaskNames(m.text) })),
    detail: s.detail
      ? {
          ...s.detail,
          conclusion: unmaskNames(s.detail.conclusion),
          facts: s.detail.facts.map(unmaskNames),
          logic: unmaskNames(s.detail.logic),
          ...(s.detail.expansions?.length
            ? { expansions: s.detail.expansions.map(unmaskNames) }
            : {}),
          ...(s.detail.challenges?.length
            ? { challenges: s.detail.challenges.map(unmaskNames) }
            : {}),
          ...(s.detail.advice ? { advice: unmaskNames(s.detail.advice) } : {}),
          ...(s.detail.adviceOverride ? { adviceOverride: unmaskNames(s.detail.adviceOverride) } : {}),
          ...(s.detail.adviceStructured
            ? { adviceStructured: mapAdviceStructuredStrings(s.detail.adviceStructured, unmaskNames) }
            : {}),
        }
      : s.detail,
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

/** createSuggestionのdetail引数。呼び出し側（APIルート）がsourceRunの内部表現（マスク済み）
 * から作る想定——ここではマスク処理をしない（既にマスク済みのテキストとして扱う）。 */
export type SuggestionDetailInput = {
  conclusion: string;
  facts: string[];
  logic: string;
  expansions?: string[];
  challenges?: string[];
  /** @deprecated 新規は adviceStructured */
  advice?: string;
  adviceStructured?: AdviceStructured;
};

export async function createSuggestion(
  title: string,
  opts: MaskOptions & {
    agentRunId?: string;
    sourceRunId?: string;
    sourceJournalId?: string;
    themeId?: string;
    teamId?: string;
    confirmPriority?: ConfirmPriority;
    id?: string;
    detail?: SuggestionDetailInput;
  } = {},
): Promise<Suggestion> {
  const {
    agentRunId,
    sourceRunId,
    sourceJournalId,
    themeId,
    teamId,
    confirmPriority: requestedPriority,
    id: forcedId,
    detail: detailInput,
    ...maskOpts
  } = opts;
  const titleTrimmed = title.trim();
  if (!titleTrimmed) throw new Error("titleは必須です");
  await ensureNameCandidatesAllowed([titleTrimmed], maskOpts);
  const maskedTitle = await maskForStorage(titleTrimmed);
  const now = Date.now();
  // docs/memo.md「メモとは別に提案自体の詳細を残す単一の場所」対応。detailInputは
  // sourceRunのproposal（既にマスク済みの内部表現）由来のため、ここでは再マスクしない。
  const detail: SuggestionDetail | undefined =
    detailInput && detailInput.conclusion.trim() && detailInput.logic.trim()
      ? (() => {
          const adviceStructured =
            detailInput.adviceStructured ??
            (detailInput.advice ? normalizeAdviceStructured(detailInput.advice) : undefined);
          return {
            conclusion: detailInput.conclusion,
            facts: detailInput.facts,
            logic: detailInput.logic,
            ...(detailInput.expansions?.length ? { expansions: detailInput.expansions } : {}),
            ...(detailInput.challenges?.length ? { challenges: detailInput.challenges } : {}),
            ...(adviceStructured ? { adviceStructured } : {}),
            updatedAt: now,
          };
        })()
      : undefined;
  const suggestion: Suggestion = {
    id: forcedId ?? randomUUID(),
    title: maskedTitle,
    reviewStatus: "unreviewed",
    confirmPriority: "normal",
    memos: [],
    detail,
    agentRunId,
    sourceRunId: sourceRunId ?? agentRunId,
    sourceJournalId,
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

const REVIEW_STATUS_LABEL: Record<SuggestionReviewStatus, string> = {
  unreviewed: "未確認",
  in_review: "確認中",
  deferred: "確認保留",
  done: "確認済み（もう追わない）",
};

export function setReviewStatus(id: string, reviewStatus: SuggestionReviewStatus): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s) return undefined;
  if (s.reviewStatus === reviewStatus) return s;
  s.reviewStatus = reviewStatus;
  s.reviewedAt = reviewStatus === "unreviewed" ? undefined : Date.now();
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent("suggestion", s.id, `確認状態を変更しました: ${REVIEW_STATUS_LABEL[reviewStatus]}`);
  return s;
}

// ユーザー要望「後回しにする場合でも『いつまでには確認したい』という期日を入力したい」
// 対応。reviewStatusとは独立に設定・解除できる（nullで解除）。
export function setSuggestionReviewDueAt(id: string, dueAt: number | null): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s) return undefined;
  const next = dueAt ?? undefined;
  if ((s.reviewDueAt ?? null) === (next ?? null)) return s;
  s.reviewDueAt = next;
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent(
    "suggestion",
    s.id,
    next ? `確認期日を設定しました: ${new Date(next).toLocaleDateString("ja-JP")}` : "確認期日を解除しました",
  );
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
  opts: MaskOptions & SuggestionUpdateReactionOptions & { source?: SuggestionMemoSource } = {},
): Promise<Suggestion | undefined> {
  const s = getSuggestion(id);
  if (!s) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return s;
  await ensureNameCandidatesAllowed([trimmed], opts);
  const masked = await maskForStorage(trimmed);
  const source = opts.source ?? "user";
  s.memos.push({ id: randomUUID(), text: masked, createdAt: Date.now(), source });
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

// docs/2nd_pivot_version.md Phase 7。SuggestionはIssue時代のcharter（why/what/how）を
// 構造化フィールドとして持たない。AIが提案するWhy/What/Howの下書きをEMが採用したときは、
// メモへ整形して残す（addMemoと同じHuman-in-the-Loop）。
export async function updateSuggestionCharter(
  id: string,
  patch: Partial<SuggestionCharter>,
  opts: MaskOptions & SuggestionUpdateReactionOptions = {},
): Promise<Suggestion | undefined> {
  const parts = (["why", "what", "how"] as const)
    .filter((k) => patch[k] !== undefined && patch[k]!.trim())
    .map((k) => `${k === "why" ? "Why" : k === "what" ? "What" : "How"}: ${patch[k]!.trim()}`);
  if (parts.length === 0) return getSuggestion(id);
  return addMemo(id, `（Charter更新）\n${parts.join("\n")}`, { ...opts, source: "agent" });
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

// docs/memo.md「メモとは別に提案自体の詳細を残す単一の場所」対応。壁打ちの継続等で
// 判断・提案（Agent）の内容が更新された後、EMが明示して現在の内容を詳細へ反映し直す用途。
// detailInputは呼び出し側（APIルート）がAgentRunの内部表現（マスク済み）から作る想定。
export function setSuggestionDetail(id: string, detailInput: SuggestionDetailInput): Suggestion | undefined {
  const s = getSuggestion(id);
  if (!s) return undefined;
  if (!detailInput.conclusion.trim() || !detailInput.logic.trim()) return s;
  // 案A: AI からの更新は adviceStructured のみ差し替え。adviceOverride は保持する。
  const preservedOverride = s.detail?.adviceOverride?.trim()
    ? s.detail.adviceOverride
    : undefined;
  const adviceStructured =
    detailInput.adviceStructured ??
    (detailInput.advice ? normalizeAdviceStructured(detailInput.advice) : undefined);
  s.detail = {
    conclusion: detailInput.conclusion,
    facts: detailInput.facts,
    logic: detailInput.logic,
    ...(detailInput.expansions?.length ? { expansions: detailInput.expansions } : {}),
    ...(detailInput.challenges?.length ? { challenges: detailInput.challenges } : {}),
    ...(adviceStructured ? { adviceStructured } : {}),
    ...(preservedOverride ? { adviceOverride: preservedOverride } : {}),
    updatedAt: Date.now(),
  };
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent("suggestion", s.id, "提案の詳細を更新しました");
  return s;
}

// ユーザー要望「提案の詳細をユーザーでも編集したい」対応。setSuggestionDetailと違い、
// こちらはEMが自由記述で書く／直す入口のため、他の自由記述フィールド（title/memo）と
// 同じくensureNameCandidatesAllowed＋maskForStorageを通す（AI由来のsetSuggestionDetailは
// 既にマスク済みのAgentRun内部表現をそのまま使うため通さない）。未指定のフィールドは
// 現在の値を保持する（部分更新）。詳細が無い状態からEMが新規に書き起こすこともできる。
// advice パッチは adviceOverride に保存し、adviceStructured は保持する。
export async function updateSuggestionDetail(
  id: string,
  patch: { conclusion?: string; facts?: string[]; logic?: string; advice?: string },
  opts: MaskOptions = {},
): Promise<Suggestion | undefined> {
  const s = getSuggestion(id);
  if (!s) return undefined;
  const current = s.detail;
  const conclusion = (patch.conclusion !== undefined ? patch.conclusion : (current?.conclusion ?? "")).trim();
  const logic = (patch.logic !== undefined ? patch.logic : (current?.logic ?? "")).trim();
  if (!conclusion || !logic) throw new Error("結論と判断ロジックは必須です");
  const facts = (patch.facts !== undefined ? patch.facts : (current?.facts ?? [])).map((f) => f.trim()).filter(Boolean);

  // advice 未指定 → 既存 override / 旧 advice を維持。空文字 → override クリア（構造表示に戻る）。
  let nextOverride: string | undefined;
  let clearOverride = false;
  if (patch.advice !== undefined) {
    const trimmed = patch.advice.trim();
    if (trimmed) nextOverride = trimmed;
    else clearOverride = true;
  } else if (current?.adviceOverride?.trim()) {
    nextOverride = current.adviceOverride;
  } else if (current?.advice?.trim() && !current.adviceStructured) {
    // 旧データ: 構造が無く plain advice だけのとき、編集していないなら advice のまま残す
    // （update で他フィールドだけ触った場合）。advice フィールドは下で保持。
  }

  const textsForMask = [conclusion, logic, ...facts, ...(nextOverride ? [nextOverride] : [])];
  await ensureNameCandidatesAllowed(textsForMask, opts);

  const [maskedConclusion, maskedLogic, maskedFacts, maskedOverride] = await Promise.all([
    maskForStorage(conclusion),
    maskForStorage(logic),
    Promise.all(facts.map((f) => maskForStorage(f))),
    nextOverride ? maskForStorage(nextOverride) : Promise.resolve(undefined),
  ]);

  // EM編集UIは結論・ファクト・ロジック・advice(→override)のみ。expansions/challenges/structuredはAI由来のため保持。
  const keepLegacyAdvice =
    patch.advice === undefined && !current?.adviceOverride && Boolean(current?.advice?.trim()) && !current?.adviceStructured;

  s.detail = {
    conclusion: maskedConclusion,
    facts: maskedFacts,
    logic: maskedLogic,
    ...(current?.expansions?.length ? { expansions: current.expansions } : {}),
    ...(current?.challenges?.length ? { challenges: current.challenges } : {}),
    ...(current?.adviceStructured ? { adviceStructured: current.adviceStructured } : {}),
    ...(maskedOverride ? { adviceOverride: maskedOverride } : {}),
    ...(keepLegacyAdvice && current?.advice ? { advice: current.advice } : {}),
    // clearOverride 時は adviceOverride も旧 advice も載せない
    updatedAt: Date.now(),
  };
  // clearOverride で structured が無い場合、編集ドラフトが空ならアドバイス無しになる
  if (clearOverride && !current?.adviceStructured) {
    // nothing else
  }
  s.updatedAt = Date.now();
  persist();
  recordChangeEvent("suggestion", s.id, "提案の詳細を編集しました");
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

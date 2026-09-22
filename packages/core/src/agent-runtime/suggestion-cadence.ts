import type { Suggestion } from "../types";
import type { AgentRun } from "./types";

// 日次で同趣旨の提案を再掲しない抑制窓。
// 「昨日だけ」だと隔日再掲になるため、最低ラインを約7日のローリングにする。
// 暦の曜日固定（毎週水曜など）にはしない — 忙しい曜日への固着を避ける。
// 抑制中の気づきは週次レビュー側で作る（batch-context-blocks の period review）。
export const SIMILAR_THEME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const BATCH_ORIGINS_FOR_COOLDOWN = new Set<AgentRun["origin"]>([
  "auto-summary",
  "auto-journal-batch",
  "auto-distill",
]);

export type RecentBatchConclusion = {
  runId: string;
  origin: AgentRun["origin"];
  at: number;
  text: string;
};

/** 直近クールダウン窓内のバッチ系結論（新規提案の重複防止用）。 */
export function listRecentBatchConclusions(
  allRuns: Iterable<AgentRun>,
  now: number,
  windowMs: number = SIMILAR_THEME_COOLDOWN_MS,
): RecentBatchConclusion[] {
  const since = now - windowMs;
  const out: RecentBatchConclusion[] = [];
  for (const r of allRuns) {
    if (!BATCH_ORIGINS_FOR_COOLDOWN.has(r.origin)) continue;
    if (r.archivedAt || r.triageStatus === "dismissed") continue;
    if (r.createdAt < since) continue;
    const text =
      r.proposal?.suggestionTitle?.trim() ||
      r.proposal?.conclusion?.trim() ||
      (r.proposal?.suggestionCandidates?.[0]?.title ?? "").trim() ||
      r.task.trim();
    if (!text) continue;
    out.push({
      runId: r.id,
      origin: r.origin,
      at: r.createdAt,
      text: text.slice(0, 160),
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

/**
 * 日次キューから意図的に外す提案（表示ロジックと揃える）。
 * parked / deferred / 未来の reviewDueAt。
 */
export function isSuggestionDeferredFromDaily(
  s: Pick<Suggestion, "confirmPriority" | "reviewStatus" | "reviewDueAt" | "archivedAt">,
  now: number,
): boolean {
  if (s.archivedAt) return true;
  if (s.confirmPriority === "parked") return true;
  if (s.reviewStatus === "deferred") return true;
  if (s.reviewDueAt !== undefined && s.reviewDueAt >= now) return true;
  return false;
}

/** 日次で触るべき未完了提案（延期・期日前を除く）。 */
export function listDailyRelevantOpenSuggestions(
  suggestions: Suggestion[],
  now: number,
  limit: number,
): Suggestion[] {
  return suggestions
    .filter((s) => !s.archivedAt && s.reviewStatus !== "done" && !isSuggestionDeferredFromDaily(s, now))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/** 日次抑制中だが週次で気づきを残す提案。 */
export function listWeeklyAwarenessSuggestions(
  suggestions: Suggestion[],
  now: number,
  limit: number,
): Suggestion[] {
  return suggestions
    .filter((s) => !s.archivedAt && s.reviewStatus !== "done" && isSuggestionDeferredFromDaily(s, now))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

// 観測カバレッジ要約ブロック。
// Explore段階の材料として、直近 Journal の偏り・Goal/Theme 未ヒット・Drift 候補を
// ヒューリスティックに集計する（外部MCP非依存。重要課題の断定には使わない）。

import { listJournalEntries, type JournalEntry } from "../journal-store";
import { listActiveGoals } from "../org-context-store/goals";
import { listActivePolicies } from "../org-context-store/policies";
import { listSuggestions } from "../suggestion-store";
import { listAdoptedThemes } from "../theme-store";
import type { OrgTheme } from "../theme/theme-types";

/** 直近窓（日） */
export const COVERAGE_RECENT_DAYS = 14;
/** 比較用の直前窓（日）— Drift 用。直近の直前に置く */
export const COVERAGE_PRIOR_DAYS = 28;
/** 集計対象の最大遡及日数 = 直近 + 直前 */
export const COVERAGE_LOOKBACK_DAYS = COVERAGE_RECENT_DAYS + COVERAGE_PRIOR_DAYS;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CoverageAxisHit = {
  id: string;
  label: string;
  recentHits: number;
  priorHits: number;
};

export type ObservationCoverageSnapshot = {
  now: number;
  recentJournalCount: number;
  priorJournalCount: number;
  topRecentTags: Array<{ tag: string; count: number }>;
  themes: CoverageAxisHit[];
  goals: CoverageAxisHit[];
  policies: CoverageAxisHit[];
  /** prior > 0 かつ recent === 0 */
  driftCandidates: Array<{ kind: "theme" | "goal" | "tag"; label: string; priorHits: number }>;
  /** recent === 0 の Goal / Theme */
  zeroRecentAxes: Array<{ kind: "theme" | "goal"; label: string }>;
};

function tokenizeForMatch(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s　、。．，,./／|｜・:：;；\-—–_()（）[\]「」『』【】]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function journalHaystack(entry: JournalEntry): string {
  return [entry.rawText, entry.summary, ...entry.tags].join("\n").toLowerCase();
}

function axisKeywords(label: string, extra?: string): string[] {
  const tokens = new Set<string>();
  for (const t of tokenizeForMatch(label)) tokens.add(t);
  if (extra) {
    for (const t of tokenizeForMatch(extra)) tokens.add(t);
  }
  return [...tokens];
}

function entryHitsAxis(haystack: string, tags: string[], keywords: string[]): boolean {
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  for (const k of keywords) {
    if (tagSet.has(k)) return true;
    if (haystack.includes(k)) return true;
  }
  return false;
}

function countHits(
  journals: JournalEntry[],
  keywords: string[],
): number {
  if (keywords.length === 0) return 0;
  let n = 0;
  for (const j of journals) {
    if (entryHitsAxis(journalHaystack(j), j.tags, keywords)) n += 1;
  }
  return n;
}

function topTags(journals: JournalEntry[], limit = 8): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const j of journals) {
    for (const tag of j.tags) {
      const key = tag.trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ja"))
    .slice(0, limit);
}

function themeKeywords(theme: OrgTheme): string[] {
  return axisKeywords(theme.title, [theme.summary, theme.rootCause ?? ""].join(" "));
}

/**
 * Emther内データから観測カバレッジのスナップショットを作る。
 * nowMs はテスト注入用。
 */
export function computeObservationCoverage(nowMs: number = Date.now()): ObservationCoverageSnapshot {
  const recentSince = nowMs - COVERAGE_RECENT_DAYS * DAY_MS;
  const priorSince = nowMs - COVERAGE_LOOKBACK_DAYS * DAY_MS;

  const journals = listJournalEntries({ includeSensitive: true }).filter(
    (j) => j.createdAt >= priorSince && j.createdAt <= nowMs,
  );
  const recent = journals.filter((j) => j.createdAt >= recentSince);
  const prior = journals.filter((j) => j.createdAt < recentSince);

  const themes = listAdoptedThemes();
  const goals = listActiveGoals();
  const policies = listActivePolicies();

  const themeHits: CoverageAxisHit[] = themes.map((t) => {
    const kw = themeKeywords(t);
    return {
      id: t.id,
      label: t.title,
      recentHits: countHits(recent, kw),
      priorHits: countHits(prior, kw),
    };
  });

  const goalHits: CoverageAxisHit[] = goals.map((g) => {
    const kw = axisKeywords(g.title, g.elaboration);
    return {
      id: g.id,
      label: g.title,
      recentHits: countHits(recent, kw),
      priorHits: countHits(prior, kw),
    };
  });

  const policyHits: CoverageAxisHit[] = policies.map((p) => {
    const kw = axisKeywords(p.text, p.elaboration);
    return {
      id: p.id,
      label: p.text.length > 40 ? `${p.text.slice(0, 40)}…` : p.text,
      recentHits: countHits(recent, kw),
      priorHits: countHits(prior, kw),
    };
  });

  const recentTagCounts = topTags(recent, 20);
  const priorTagCounts = new Map(topTags(prior, 40).map((t) => [t.tag.toLowerCase(), t.count]));

  const driftCandidates: ObservationCoverageSnapshot["driftCandidates"] = [];
  for (const t of themeHits) {
    if (t.priorHits > 0 && t.recentHits === 0) {
      driftCandidates.push({ kind: "theme", label: t.label, priorHits: t.priorHits });
    }
  }
  for (const g of goalHits) {
    if (g.priorHits > 0 && g.recentHits === 0) {
      driftCandidates.push({ kind: "goal", label: g.label, priorHits: g.priorHits });
    }
  }
  for (const [tag, priorCount] of priorTagCounts) {
    const recentCount = recentTagCounts.find((t) => t.tag.toLowerCase() === tag)?.count ?? 0;
    if (priorCount > 0 && recentCount === 0) {
      driftCandidates.push({ kind: "tag", label: tag, priorHits: priorCount });
    }
  }
  driftCandidates.sort((a, b) => b.priorHits - a.priorHits);

  const zeroRecentAxes: ObservationCoverageSnapshot["zeroRecentAxes"] = [
    ...themeHits.filter((t) => t.recentHits === 0).map((t) => ({ kind: "theme" as const, label: t.label })),
    ...goalHits.filter((g) => g.recentHits === 0).map((g) => ({ kind: "goal" as const, label: g.label })),
  ];

  return {
    now: nowMs,
    recentJournalCount: recent.length,
    priorJournalCount: prior.length,
    topRecentTags: recentTagCounts.slice(0, 8),
    themes: themeHits,
    goals: goalHits,
    policies: policyHits,
    driftCandidates: driftCandidates.slice(0, 10),
    zeroRecentAxes: zeroRecentAxes.slice(0, 12),
  };
}

function formatAxisLines(hits: CoverageAxisHit[], emptyLabel: string): string[] {
  if (hits.length === 0) return [`- （${emptyLabel}なし）`];
  return hits.map((h) => `- ${h.label}: 直近${h.recentHits}件 / 直前${h.priorHits}件`);
}

/**
 * システムプロンプト末尾用の観測カバレッジ要約。
 * データがほぼ空（Journalも軸も無い）なら空文字を返し、ブロック自体を省略する。
 */
export function buildObservationCoverageBlock(nowMs: number = Date.now()): string {
  const snap = computeObservationCoverage(nowMs);
  const hasAxes = snap.themes.length > 0 || snap.goals.length > 0 || snap.policies.length > 0;
  if (snap.recentJournalCount === 0 && snap.priorJournalCount === 0 && !hasAxes) {
    return "";
  }

  const openSuggestions = listSuggestions().filter((s) => !s.archivedAt && s.reviewStatus !== "done");
  const themedOpen = openSuggestions.filter((s) => s.themeId).length;
  const unthemedOpen = openSuggestions.length - themedOpen;

  const lines: string[] = [
    "観測カバレッジ要約（Exploreの候補材料。重要課題の断定には使わないこと。記録が少ない＝問題、とは限らない）:",
    `- 集計窓: 直近${COVERAGE_RECENT_DAYS}日（Journal ${snap.recentJournalCount}件） / その直前${COVERAGE_PRIOR_DAYS}日（Journal ${snap.priorJournalCount}件）`,
    `- 未完了提案: ${openSuggestions.length}件（Theme紐付けあり ${themedOpen} / なし ${unthemedOpen}）`,
  ];

  if (snap.topRecentTags.length > 0) {
    lines.push(
      "- 直近で多いタグ:",
      ...snap.topRecentTags.map((t) => `  - ${t.tag}（${t.count}）`),
    );
  } else {
    lines.push("- 直近で多いタグ: （なし）");
  }

  lines.push("- 採用Themeごとのヒット数:", ...formatAxisLines(snap.themes, "採用Theme"));
  lines.push("- Goalごとのヒット数:", ...formatAxisLines(snap.goals, "Goal"));
  if (snap.policies.length > 0) {
    lines.push("- Policy文言のヒット数:", ...formatAxisLines(snap.policies, "Policy"));
  }

  if (snap.zeroRecentAxes.length > 0) {
    lines.push(
      "- 直近ヒット0の軸（未観測候補）:",
      ...snap.zeroRecentAxes.map((z) => `  - [${z.kind}] ${z.label}`),
    );
  }

  if (snap.driftCandidates.length > 0) {
    lines.push(
      "- Drift候補（直前はヒットしたが直近0）:",
      ...snap.driftCandidates.map((d) => `  - [${d.kind}] ${d.label}（直前${d.priorHits}件）`),
    );
  }

  lines.push(
    "- 使い方: Blind Spot / Drift / Unexplored Area の候補検討に使う。関連性が弱いものはEMへ提示しない。件数だけで断定しない。",
  );

  return lines.join("\n");
}

import type { Issue, IssuePriority } from "@/lib/issue-store";

// docs/value_hierarchy_and_flow.md §4.3。帯付けの内部根拠。
// score ≈ (CoD × BlastRadius / max(Effort, ε)) × Confidence

export type IssueTriageScores = {
  costOfDelay: number;
  effort: number;
  blastRadius: number;
  confidence: number;
  score: number;
  suggestedPriority: IssuePriority;
  scoredAt: number;
};

const EPSILON = 0.05;
const STALE_DAYS = 14;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function isParentStalled(issue: Issue, now: number, staleDays: number): boolean {
  if (issue.archived || issue.status === "done" || issue.parentId) return false;
  const charterFilled = [issue.charter.why, issue.charter.what, issue.charter.how].filter((v) => v.trim()).length;
  if (charterFilled === 0 && issue.actionItems.length === 0) return false;
  return now - issue.updatedAt > staleDays * 24 * 60 * 60 * 1000;
}

export function computeTriageScore(axes: {
  costOfDelay: number;
  effort: number;
  blastRadius: number;
  confidence: number;
}): number {
  const cod = clamp01(axes.costOfDelay);
  const effort = Math.max(clamp01(axes.effort), EPSILON);
  const blast = clamp01(axes.blastRadius);
  const confidence = clamp01(axes.confidence);
  return ((cod * blast) / effort) * confidence;
}

export function suggestedPriorityFromScore(score: number, stalledParkCandidate: boolean): IssuePriority {
  if (stalledParkCandidate && score < 0.45) return "parked";
  if (score >= 0.55) return "focus";
  if (score >= 0.25) return "normal";
  return "parked";
}

/** ルールベース採点。UI マトリクス入力なしで帯提案の材料にする。 */
export function scoreIssueHeuristically(
  issue: Issue,
  opts: { now?: number; hasThemeLink?: boolean; hasKrLink?: boolean } = {},
): IssueTriageScores {
  const now = opts.now ?? Date.now();
  const ageDays = (now - issue.createdAt) / (24 * 60 * 60 * 1000);
  const idleDays = (now - issue.updatedAt) / (24 * 60 * 60 * 1000);

  let costOfDelay = 0.35;
  if (issue.status === "blocked") costOfDelay += 0.35;
  if (idleDays > 7) costOfDelay += 0.15;
  if (idleDays > 21) costOfDelay += 0.15;
  if (issue.tags.some((t) => /リスク|離職|バーン|障害|炎上|urgent/i.test(t))) costOfDelay += 0.2;

  const charterBits = [issue.charter.why, issue.charter.what, issue.charter.how].filter((v) => v.trim()).length;
  let effort = 0.35;
  if (charterBits === 0) effort += 0.2;
  if (issue.actionItems.length >= 5) effort += 0.25;
  else if (issue.actionItems.length >= 2) effort += 0.1;
  if (issue.status === "blocked") effort += 0.1;

  let blastRadius = 0.3;
  if (issue.teamId) blastRadius += 0.25;
  if (opts.hasThemeLink || issue.themeId) blastRadius += 0.2;
  if (opts.hasKrLink || issue.keyResultId) blastRadius += 0.15;
  if (issue.tags.some((t) => /組織|横断|全社|チーム/i.test(t))) blastRadius += 0.15;

  let confidence = 0.4;
  confidence += charterBits * 0.12;
  if (issue.logEntries.length > 0) confidence += 0.1;
  if (issue.sourceJournalId) confidence += 0.15;
  if (ageDays > 30 && issue.logEntries.length === 0) confidence -= 0.2;

  costOfDelay = clamp01(costOfDelay);
  effort = clamp01(effort);
  blastRadius = clamp01(blastRadius);
  confidence = clamp01(confidence);

  const score = computeTriageScore({ costOfDelay, effort, blastRadius, confidence });
  const stalled = isParentStalled(issue, now, STALE_DAYS);
  const noActivity = issue.logEntries.length === 0 && !issue.sourceJournalId && idleDays > STALE_DAYS;
  const suggestedPriority = suggestedPriorityFromScore(score, stalled || noActivity);

  return {
    costOfDelay,
    effort,
    blastRadius,
    confidence,
    score,
    suggestedPriority,
    scoredAt: now,
  };
}

export function compareByTriageScore(
  a: { triage?: IssueTriageScores | null },
  b: { triage?: IssueTriageScores | null },
): number {
  return (b.triage?.score ?? 0) - (a.triage?.score ?? 0);
}

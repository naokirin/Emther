import { extractFirstJsonObject } from "@/lib/local-model";
import { runCloudChat } from "@/lib/cloud-chat";
import type { Issue, IssuePriority } from "@/lib/issue-store";
import { getTeam, listObjectives } from "@/lib/org-context-store";
import { getTheme } from "@/lib/theme-store";

// docs/value_hierarchy_and_flow.md §4.3。帯付けの内部根拠。
// score ≈ (CoD × BlastRadius / max(Effort, ε)) × Confidence
// 本番は外部AIで4軸を推定。失敗時のみヒューリスティック。一括は「内容未更新はスキップ」。

export type IssueTriageSource = "ai" | "heuristic";

export type IssueTriageScores = {
  costOfDelay: number;
  effort: number;
  blastRadius: number;
  confidence: number;
  score: number;
  suggestedPriority: IssuePriority;
  scoredAt: number;
  /** 採点手段。旧データは未設定（heuristic 相当のルール採点）。 */
  source?: IssueTriageSource;
};

const EPSILON = 0.05;
const STALE_DAYS = 14;
/** 一括 AI 採点の1回あたり上限（コスト抑制）。超過分は既存 triage を維持、無ければ heuristic。 */
export const TRIAGE_AI_BATCH_LIMIT = 12;

const SYSTEM_PROMPT = [
  "あなたはエンジニアリングマネージャーの介入課題（Issue）を優先度付けするツールです。",
  "説明や前置き・Markdownフェンスは書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"scores":[{"issueId":string,"costOfDelay":number,"effort":number,"blastRadius":number,"confidence":number}]}',
  "各数値は 0.0〜1.0。入力の issueId をそのまま使うこと。入力に無い Issue を作らない。",
  "costOfDelay（放置リスク）: 今見なくてよいか。休職・体制移行・離職・品質崩壊・障害・期限付き組織リスクは高く。単なる未更新だけでは高くしない。",
  "effort（介入コスト）: EM が片付ける重さ。合意形成・人員再配置・仕組み変更は高め、短い確認は低め。",
  "blastRadius（影響半径）: 個人1名の局所か、チーム／横断／全社か。テーマや KR 紐付けは広がりやすい信号。",
  "confidence（確信度）: Charter・事実の足り具合。材料が薄いときは低くする。",
  "入力に無い事実を捏造しない。人名は PERSON_n のまま扱う。",
].join("\n");

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

/**
 * 一括再評価のスキップ判定（案 A）。
 * 前回採点以降に Issue 本体が更新されていなければ再評価しない。
 * 詳細画面の強制再採点は force=true。
 */
export function needsTriageRescore(
  issue: Issue,
  opts: { force?: boolean } = {},
): boolean {
  if (opts.force) return true;
  if (!issue.triage) return true;
  return issue.updatedAt > issue.triage.scoredAt;
}

function finalizeScores(
  issue: Issue,
  axes: { costOfDelay: number; effort: number; blastRadius: number; confidence: number },
  opts: { now: number; source: IssueTriageSource },
): IssueTriageScores {
  const costOfDelay = clamp01(axes.costOfDelay);
  const effort = clamp01(axes.effort);
  const blastRadius = clamp01(axes.blastRadius);
  const confidence = clamp01(axes.confidence);
  const score = computeTriageScore({ costOfDelay, effort, blastRadius, confidence });
  const stalled = isParentStalled(issue, opts.now, STALE_DAYS);
  const idleDays = (opts.now - issue.updatedAt) / (24 * 60 * 60 * 1000);
  const noActivity = issue.logEntries.length === 0 && !issue.sourceJournalId && idleDays > STALE_DAYS;
  return {
    costOfDelay,
    effort,
    blastRadius,
    confidence,
    score,
    suggestedPriority: suggestedPriorityFromScore(score, stalled || noActivity),
    scoredAt: opts.now,
    source: opts.source,
  };
}

/** ルールベース採点。AI 失敗時・バッチ超過時のフォールバック。 */
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
  if (issue.tags.some((t) => /リスク|離職|休職|バーン|障害|炎上|urgent|体制/i.test(t))) costOfDelay += 0.2;

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

  return finalizeScores(
    issue,
    { costOfDelay, effort, blastRadius, confidence },
    { now, source: "heuristic" },
  );
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function resolveLinkLabels(issue: Issue): { themeTitle?: string; keyResultTitle?: string; teamName?: string } {
  const themeTitle = issue.themeId ? getTheme(issue.themeId)?.title : undefined;
  let keyResultTitle: string | undefined;
  if (issue.keyResultId) {
    for (const o of listObjectives()) {
      const kr = o.keyResults.find((k) => k.id === issue.keyResultId);
      if (kr) {
        keyResultTitle = kr.title;
        break;
      }
    }
  }
  const teamName = issue.teamId ? getTeam(issue.teamId)?.name : undefined;
  return { themeTitle, keyResultTitle, teamName };
}

/** クラウドへ渡す厳選コンテキスト（マスク済みフィールドのまま）。 */
export function buildTriageIssueContextBlock(issue: Issue, now: number): string {
  const ageDays = Math.floor((now - issue.createdAt) / (24 * 60 * 60 * 1000));
  const idleDays = Math.floor((now - issue.updatedAt) / (24 * 60 * 60 * 1000));
  const links = resolveLinkLabels(issue);
  const openItems = issue.actionItems
    .filter((a) => !a.done)
    .slice(0, 3)
    .map((a) => truncate(a.text, 80));
  const recentLogs = [...issue.logEntries]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 2)
    .map((l) => truncate(l.text, 120));

  const lines = [
    `- issueId=${issue.id}`,
    `  title: ${truncate(issue.title, 120)}`,
    `  status: ${issue.status}`,
    `  tags: ${issue.tags.length ? issue.tags.join(", ") : "(none)"}`,
    `  charter.why: ${truncate(issue.charter.why, 200) || "(empty)"}`,
    `  charter.what: ${truncate(issue.charter.what, 200) || "(empty)"}`,
    `  charter.how: ${truncate(issue.charter.how, 200) || "(empty)"}`,
    `  actionItemCount: ${issue.actionItems.length} (open ${issue.actionItems.filter((a) => !a.done).length})`,
    `  openActionItems: ${openItems.length ? openItems.join(" | ") : "(none)"}`,
    `  recentLogs: ${recentLogs.length ? recentLogs.join(" | ") : "(none)"}`,
    `  theme: ${links.themeTitle ? truncate(links.themeTitle, 100) : "(none)"}`,
    `  keyResult: ${links.keyResultTitle ? truncate(links.keyResultTitle, 100) : "(none)"}`,
    `  team: ${links.teamName ? truncate(links.teamName, 80) : "(none)"}`,
    `  ageDays: ${ageDays}`,
    `  idleDays: ${idleDays}`,
    `  hasSourceJournal: ${issue.sourceJournalId ? "yes" : "no"}`,
  ];
  return lines.join("\n");
}

function parseAxisNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return clamp01(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return clamp01(Number(v));
  return null;
}

/** AI 応答 JSON から issueId → 4軸を取り出す（テスト用に export）。 */
export function parseTriageAiScores(raw: unknown): Map<
  string,
  { costOfDelay: number; effort: number; blastRadius: number; confidence: number }
> {
  const out = new Map<
    string,
    { costOfDelay: number; effort: number; blastRadius: number; confidence: number }
  >();
  if (!raw || typeof raw !== "object") return out;
  const list = (raw as { scores?: unknown }).scores;
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const issueId = typeof row.issueId === "string" ? row.issueId : "";
    if (!issueId) continue;
    const costOfDelay = parseAxisNumber(row.costOfDelay);
    const effort = parseAxisNumber(row.effort);
    const blastRadius = parseAxisNumber(row.blastRadius);
    const confidence = parseAxisNumber(row.confidence);
    if (costOfDelay === null || effort === null || blastRadius === null || confidence === null) continue;
    out.set(issueId, { costOfDelay, effort, blastRadius, confidence });
  }
  return out;
}

async function scoreIssuesWithCloudAi(
  issues: Issue[],
  now: number,
): Promise<Map<string, IssueTriageScores>> {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const result = new Map<string, IssueTriageScores>();
  if (issues.length === 0) return result;

  const userPrompt = [
    "次の Issue それぞれについて、4軸スコアを JSON で返してください。",
    "",
    "Issues:",
    issues.map((i) => buildTriageIssueContextBlock(i, now)).join("\n"),
  ].join("\n");

  const content = await runCloudChat(SYSTEM_PROMPT, userPrompt);
  const jsonText = extractFirstJsonObject(content);
  if (!jsonText) return result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return result;
  }
  for (const [issueId, axes] of parseTriageAiScores(parsed)) {
    const issue = byId.get(issueId);
    if (!issue) continue;
    result.set(issueId, finalizeScores(issue, axes, { now, source: "ai" }));
  }
  return result;
}

export type ScoreIssueTriageResult = {
  triage: IssueTriageScores;
  /** 既存 triage をそのまま使った（再採点しなかった） */
  skipped: boolean;
};

/**
 * 1件採点。force または未採点／更新ありのとき AI（失敗時 heuristic）。
 * それ以外は既存 triage を返す。
 */
export async function scoreIssueTriage(
  issue: Issue,
  opts: { now?: number; force?: boolean } = {},
): Promise<ScoreIssueTriageResult> {
  const now = opts.now ?? Date.now();
  if (!needsTriageRescore(issue, { force: opts.force }) && issue.triage) {
    return { triage: issue.triage, skipped: true };
  }

  try {
    const ai = await scoreIssuesWithCloudAi([issue], now);
    const scored = ai.get(issue.id);
    if (scored) return { triage: scored, skipped: false };
  } catch {
    // フォールバックへ
  }

  return {
    triage: scoreIssueHeuristically(issue, {
      now,
      hasThemeLink: !!issue.themeId,
      hasKrLink: !!issue.keyResultId,
    }),
    skipped: false,
  };
}

export type ScoreIssuesTriageBatchResult = {
  byId: Map<string, IssueTriageScores>;
  rescoredIds: string[];
  skippedUnchangedIds: string[];
  /** バッチ上限のため AI に回さなかった（既存維持 or heuristic 新規） */
  deferredIds: string[];
  aiCount: number;
  heuristicCount: number;
};

/**
 * 複数件。force でない限り updatedAt <= scoredAt はスキップ。
 * 要再採点は最大 TRIAGE_AI_BATCH_LIMIT 件だけ AI。超過は既存維持（無ければ heuristic）。
 */
export async function scoreIssuesTriageBatch(
  issues: Issue[],
  opts: { now?: number; force?: boolean; batchLimit?: number } = {},
): Promise<ScoreIssuesTriageBatchResult> {
  const now = opts.now ?? Date.now();
  const batchLimit = opts.batchLimit ?? TRIAGE_AI_BATCH_LIMIT;
  const byId = new Map<string, IssueTriageScores>();
  const skippedUnchangedIds: string[] = [];
  const needRescore: Issue[] = [];

  for (const issue of issues) {
    if (!needsTriageRescore(issue, { force: opts.force }) && issue.triage) {
      byId.set(issue.id, issue.triage);
      skippedUnchangedIds.push(issue.id);
    } else {
      needRescore.push(issue);
    }
  }

  const toAi = needRescore.slice(0, batchLimit);
  const deferred = needRescore.slice(batchLimit);
  const deferredIds = deferred.map((i) => i.id);

  let aiMap = new Map<string, IssueTriageScores>();
  if (toAi.length > 0) {
    try {
      aiMap = await scoreIssuesWithCloudAi(toAi, now);
    } catch {
      aiMap = new Map();
    }
  }

  const rescoredIds: string[] = [];
  let aiCount = 0;
  let heuristicCount = 0;

  for (const issue of toAi) {
    const fromAi = aiMap.get(issue.id);
    if (fromAi) {
      byId.set(issue.id, fromAi);
      aiCount += 1;
    } else {
      byId.set(
        issue.id,
        scoreIssueHeuristically(issue, {
          now,
          hasThemeLink: !!issue.themeId,
          hasKrLink: !!issue.keyResultId,
        }),
      );
      heuristicCount += 1;
    }
    rescoredIds.push(issue.id);
  }

  for (const issue of deferred) {
    if (issue.triage) {
      byId.set(issue.id, issue.triage);
    } else {
      byId.set(
        issue.id,
        scoreIssueHeuristically(issue, {
          now,
          hasThemeLink: !!issue.themeId,
          hasKrLink: !!issue.keyResultId,
        }),
      );
      heuristicCount += 1;
      rescoredIds.push(issue.id);
    }
  }

  return {
    byId,
    rescoredIds,
    skippedUnchangedIds,
    deferredIds,
    aiCount,
    heuristicCount,
  };
}

export function compareByTriageScore(
  a: { triage?: IssueTriageScores | null },
  b: { triage?: IssueTriageScores | null },
): number {
  return (b.triage?.score ?? 0) - (a.triage?.score ?? 0);
}

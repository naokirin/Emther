import { extractFirstJsonObject } from "./local-model";
import { runCloudChat } from "./cloud-chat";
import { listIssues } from "./issue-store";
import { getTheme, listAdoptedThemes, toThemeView, type OrgTheme } from "./theme-store";
import { listGoals } from "./org-context-store/index";
import { unmaskNames } from "./people-directory";
import { isIssueStrategyUnlinked, type GoalLinkSuggestion, type Issue, type IssueStrategyLinkSuggestion } from "./types";

export type { GoalLinkSuggestion, IssueStrategyLinkSuggestion };

export type LinkSuggestSource = "cloud" | "heuristic";

export type LinkSuggestResult<T> = {
  suggestions: T[];
  targetCount: number;
  source: LinkSuggestSource;
  /** source が heuristic のとき、フォールバック理由（診断・UI 表示用） */
  fallbackReason?: string;
};

// 戦略未接続の親 Issue → テーマ を AI（失敗時はヒューリスティック）で提案する。
// 永続化はしない（HITL）。採用は既存 PATCH（issue themeId）。
// クラウドへ渡す本文はストア上のマスク済みテキストのままにする（toThemeView で実名復元すると
// assertNoRealNamesLeaked で即失敗し、類似度フォールバックに落ちる）。

const ISSUE_SYSTEM_PROMPT = [
  "あなたは組織の階層接続（テーマ ↔ Issue）を提案するツールです。説明や前置き・Markdownフェンスは書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"suggestions":[{"issueId":string,"themeId":string|null,"rationale":string}]}',
  "themeIdは入力リストにあるIDのみ。無い候補はnull。",
  "rationale は日本語で1文。入力に無い事実を捏造しない。",
].join("\n");

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const spaced = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  for (const t of spaced) tokens.add(t);
  const compact = text.replace(/\s+/g, "");
  for (let i = 0; i < compact.length - 1; i++) {
    const bi = compact.slice(i, i + 2);
    if (/[぀-ヿ㐀-鿿]/.test(bi)) tokens.add(bi);
  }
  return tokens;
}

function overlapScore(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.sqrt(ta.size * tb.size);
}

function logFallback(scope: string, reason: string): void {
  console.warn(`[link-suggest] ${scope}: heuristic fallback — ${reason}`);
}

function labelIssueSuggestion(
  issue: Issue,
  themeId: string | null,
  rationale: string,
  themes: OrgTheme[],
): IssueStrategyLinkSuggestion | null {
  const theme = themeId ? themes.find((t) => t.id === themeId) : undefined;
  const resolvedThemeId = theme ? theme.id : null;
  if (!resolvedThemeId) return null;
  return {
    issueId: issue.id,
    issueTitle: unmaskNames(issue.title),
    themeId: resolvedThemeId,
    rationale: rationale.trim() || "内容の類似から候補を選びました",
    labels: { theme: theme ? toThemeView(theme).title : undefined },
  };
}

function heuristicIssueSuggestion(issue: Issue, themes: OrgTheme[]): IssueStrategyLinkSuggestion | null {
  const hay = [issue.title, issue.charter.why, issue.charter.what, issue.charter.how, issue.tags.join(" ")].join(
    " ",
  );
  const rankedThemes = themes
    .map((t) => ({
      t,
      score: overlapScore(hay, [t.title, t.summary, t.rationale].join(" ")),
    }))
    .filter((x) => x.score > 0.08)
    .sort((a, b) => b.score - a.score);

  const themeId: string | null = rankedThemes[0]?.t.id ?? null;

  if (!themeId) {
    if (themes.length === 1) {
      const only = themes[0];
      return labelIssueSuggestion(
        issue,
        only.id,
        "唯一の採用テーマへ暫定リンクを提案します（内容照合が弱いため要確認）",
        themes,
      );
    }
    return null;
  }

  return labelIssueSuggestion(issue, themeId, "Issue内容とテーマ文言の類似から候補を選びました", themes);
}

function parseIssueCloud(
  raw: unknown,
  targets: Issue[],
  themes: OrgTheme[],
): {
  suggestions: IssueStrategyLinkSuggestion[];
  stats: { raw: number; matchedIssue: number; labeled: number; nullTheme: number; unknownTheme: number };
} {
  const stats = { raw: 0, matchedIssue: 0, labeled: 0, nullTheme: 0, unknownTheme: 0 };
  if (!raw || typeof raw !== "object") return { suggestions: [], stats };
  const suggestions = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return { suggestions: [], stats };
  const byId = new Map(targets.map((i) => [i.id, i]));
  const out: IssueStrategyLinkSuggestion[] = [];
  for (const item of suggestions) {
    stats.raw++;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const issueId = typeof row.issueId === "string" ? row.issueId : "";
    const issue = byId.get(issueId);
    if (!issue) continue;
    stats.matchedIssue++;
    const themeIdRaw = typeof row.themeId === "string" ? row.themeId : null;
    if (!themeIdRaw) stats.nullTheme++;
    if (themeIdRaw && !themes.some((t) => t.id === themeIdRaw)) stats.unknownTheme++;
    const rationale = typeof row.rationale === "string" ? row.rationale : "";
    const labeled = labelIssueSuggestion(issue, themeIdRaw, rationale, themes);
    if (labeled) {
      stats.labeled++;
      out.push(labeled);
    }
  }
  return { suggestions: out, stats };
}

function selectUnlinkedIssues(issueIds?: string[]): Issue[] {
  const filter = issueIds?.length ? new Set(issueIds) : null;
  return listIssues()
    .filter((i) => !i.archived && i.status !== "done" && !i.parentId && isIssueStrategyUnlinked(i))
    .filter((i) => (filter ? filter.has(i.id) : true))
    .slice(0, 15);
}

export async function suggestIssueStrategyLinks(opts?: {
  issueIds?: string[];
}): Promise<LinkSuggestResult<IssueStrategyLinkSuggestion>> {
  const targets = selectUnlinkedIssues(opts?.issueIds);
  const themes = listAdoptedThemes();
  if (targets.length === 0 || themes.length === 0) {
    const fallbackReason = targets.length === 0 ? "no_unlinked_parent_issues" : "no_theme_candidates";
    logFallback("issue→strategy", fallbackReason);
    return { suggestions: [], targetCount: targets.length, source: "heuristic", fallbackReason };
  }

  // Issue / テーマともマスク済みのまま（実名復元すると送信ガードで即失敗する）
  const issueBlock = targets
    .map((i) => {
      return [
        `- issueId=${i.id}`,
        `  title: ${i.title}`,
        `  why: ${i.charter.why}`,
        `  what: ${i.charter.what}`,
        `  how: ${i.charter.how}`,
        `  tags: ${i.tags.join(", ") || "(なし)"}`,
      ].join("\n");
    })
    .join("\n");
  const themeBlock = themes
    .map((t) => `- themeId=${t.id} ${t.title} — ${t.summary}`)
    .join("\n");

  let cloud: IssueStrategyLinkSuggestion[] = [];
  let fallbackReason: string | undefined;
  try {
    const content = await runCloudChat(
      ISSUE_SYSTEM_PROMPT,
      ["戦略未接続の親 Issue:", issueBlock, "", "採用テーマ候補:", themeBlock].join("\n"),
    );
    const jsonText = extractFirstJsonObject(content);
    if (!jsonText) {
      fallbackReason = "cloud_response_had_no_json";
      console.warn(
        `[link-suggest] issue→strategy: ${fallbackReason} (responseChars=${content.length})`,
      );
    } else {
      try {
        const parsed = parseIssueCloud(JSON.parse(jsonText), targets, themes);
        cloud = parsed.suggestions;
        if (cloud.length === 0) {
          fallbackReason = `cloud_json_parsed_but_no_valid_suggestions(raw=${parsed.stats.raw},matchedIssue=${parsed.stats.matchedIssue},labeled=${parsed.stats.labeled},nullTheme=${parsed.stats.nullTheme},unknownTheme=${parsed.stats.unknownTheme})`;
          console.warn(`[link-suggest] issue→strategy: ${fallbackReason}`);
        }
      } catch (err) {
        fallbackReason = `cloud_json_parse_error: ${(err as Error).message}`;
        console.warn(`[link-suggest] issue→strategy: ${fallbackReason}`);
      }
    }
  } catch (err) {
    fallbackReason = `cloud_error: ${(err as Error).message}`;
    logFallback("issue→strategy", fallbackReason);
  }

  if (cloud.length > 0) {
    const covered = new Set(cloud.map((s) => s.issueId));
    const filled = [...cloud];
    for (const i of targets) {
      if (covered.has(i.id)) continue;
      const h = heuristicIssueSuggestion(i, themes);
      if (h) filled.push(h);
    }
    return { suggestions: filled, targetCount: targets.length, source: "cloud" };
  }

  const heuristic = targets
    .map((i) => heuristicIssueSuggestion(i, themes))
    .filter((s): s is IssueStrategyLinkSuggestion => !!s);
  const reason = fallbackReason ?? "cloud_unavailable_unknown";
  if (!fallbackReason) logFallback("issue→strategy", reason);
  return {
    suggestions: heuristic,
    targetCount: targets.length,
    source: "heuristic",
    fallbackReason: reason,
  };
}

// docs/goal_policy_model_plan.md Decision 1 / Phase 2。未リンクの採用テーマに、Goal候補を
// AI（失敗時はヒューリスティック）で提案する。既存のHITLパターン（永続化はしない。採用は
// 既存PATCH経由）。

type GoalCatalogEntry = { id: string; title: string; text: string };

function buildGoalCatalog(): GoalCatalogEntry[] {
  // マスク済みのまま（クラウド送信・類似度照合用）。表示ラベルはlabelGoalSuggestionでunmaskする。
  return listGoals()
    .filter((g) => g.status === "active")
    .map((g) => ({ id: g.id, title: g.title, text: [g.title, g.note ?? ""].join(" ") }));
}

type GoalLinkSourceRaw = { id: string; maskedTitle: string; hay: string };

function unlinkedThemeGoalSources(ids?: string[]): GoalLinkSourceRaw[] {
  const filter = ids?.length ? new Set(ids) : null;
  return listAdoptedThemes()
    .filter((t) => !(t.goalIds?.length))
    .filter((t) => (filter ? filter.has(t.id) : true))
    .slice(0, 10)
    .map((t) => ({
      id: t.id,
      maskedTitle: t.title,
      hay: [t.title, t.summary, t.rationale, t.suggestedDirection ?? ""].join(" "),
    }));
}

function goalLinkSourceTitle(id: string): string {
  const t = getTheme(id);
  return t ? toThemeView(t).title : id;
}

const GOAL_SYSTEM_PROMPT = [
  "あなたは組織の階層接続（Goal ↔ 採用テーマ）を提案するツールです。説明や前置き・Markdownフェンスは書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"suggestions":[{"sourceId":string,"goalIds":string[],"rationale":string}]}',
  "goalIds は入力リストにある ID のみを使うこと。無い場合は空配列。",
  "各テーマに最も関連する Goal を最大2まで。無理に全部埋めない。",
  "rationale は日本語で1文。入力に無い事実を捏造しない。",
].join("\n");

function labelGoalSuggestion(
  sourceId: string,
  goalIds: string[],
  rationale: string,
  catalog: GoalCatalogEntry[],
): GoalLinkSuggestion | null {
  const valid = goalIds.filter((id) => catalog.some((g) => g.id === id));
  if (valid.length === 0) return null;
  return {
    sourceKind: "theme",
    sourceId,
    sourceTitle: goalLinkSourceTitle(sourceId),
    goalIds: valid,
    rationale: rationale.trim() || "内容の類似から候補を選びました",
    labels: { goals: valid.map((id) => unmaskNames(catalog.find((g) => g.id === id)!.title)) },
  };
}

function heuristicGoalSuggestion(src: GoalLinkSourceRaw, catalog: GoalCatalogEntry[]): GoalLinkSuggestion | null {
  const ranked = catalog
    .map((g) => ({ g, score: overlapScore(src.hay, g.text) }))
    .filter((x) => x.score > 0.08)
    .sort((a, b) => b.score - a.score);
  const goalIds = ranked.slice(0, 2).map((x) => x.g.id);
  if (goalIds.length === 0) {
    if (catalog.length === 1) {
      return labelGoalSuggestion(
        src.id,
        [catalog[0].id],
        "唯一のGoalへ暫定リンクを提案します（内容照合が弱いため要確認）",
        catalog,
      );
    }
    return null;
  }
  return labelGoalSuggestion(src.id, goalIds, "内容の類似からGoal候補を選びました", catalog);
}

function parseGoalCloud(
  raw: unknown,
  sources: GoalLinkSourceRaw[],
  catalog: GoalCatalogEntry[],
): { suggestions: GoalLinkSuggestion[]; stats: { raw: number; matchedSource: number; labeled: number } } {
  const stats = { raw: 0, matchedSource: 0, labeled: 0 };
  if (!raw || typeof raw !== "object") return { suggestions: [], stats };
  const suggestions = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return { suggestions: [], stats };
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out: GoalLinkSuggestion[] = [];
  for (const item of suggestions) {
    stats.raw++;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sourceId = typeof row.sourceId === "string" ? row.sourceId : "";
    const src = byId.get(sourceId);
    if (!src) continue;
    stats.matchedSource++;
    const goalIds = Array.isArray(row.goalIds) ? row.goalIds.filter((id): id is string => typeof id === "string") : [];
    const rationale = typeof row.rationale === "string" ? row.rationale : "";
    const labeled = labelGoalSuggestion(src.id, goalIds, rationale, catalog);
    if (labeled) {
      stats.labeled++;
      out.push(labeled);
    }
  }
  return { suggestions: out, stats };
}

export async function suggestThemeGoalLinks(opts?: { ids?: string[] }): Promise<LinkSuggestResult<GoalLinkSuggestion>> {
  const sources = unlinkedThemeGoalSources(opts?.ids);
  const catalog = buildGoalCatalog();
  const scopeLabel = "theme→goal";
  if (sources.length === 0 || catalog.length === 0) {
    const fallbackReason = sources.length === 0 ? "no_unlinked_themes" : "no_goal_candidates";
    logFallback(scopeLabel, fallbackReason);
    return { suggestions: [], targetCount: sources.length, source: "heuristic", fallbackReason };
  }

  const sourceBlock = sources.map((s) => `- sourceId=${s.id}\n  title: ${s.maskedTitle}\n  detail: ${s.hay}`).join("\n");
  const goalBlock = catalog.map((g) => `- goalId=${g.id} ${g.title}`).join("\n");

  let cloud: GoalLinkSuggestion[] = [];
  let fallbackReason: string | undefined;
  try {
    const content = await runCloudChat(
      GOAL_SYSTEM_PROMPT,
      ["未リンクの採用テーマ:", sourceBlock, "", "リンク先候補のGoal:", goalBlock].join("\n"),
    );
    const jsonText = extractFirstJsonObject(content);
    if (!jsonText) {
      fallbackReason = "cloud_response_had_no_json";
      console.warn(`[link-suggest] ${scopeLabel}: ${fallbackReason} (responseChars=${content.length})`);
    } else {
      try {
        const parsed = parseGoalCloud(JSON.parse(jsonText), sources, catalog);
        cloud = parsed.suggestions;
        if (cloud.length === 0) {
          fallbackReason = `cloud_json_parsed_but_no_valid_suggestions(raw=${parsed.stats.raw},matchedSource=${parsed.stats.matchedSource},labeled=${parsed.stats.labeled})`;
          console.warn(`[link-suggest] ${scopeLabel}: ${fallbackReason}`);
        }
      } catch (err) {
        fallbackReason = `cloud_json_parse_error: ${(err as Error).message}`;
        console.warn(`[link-suggest] ${scopeLabel}: ${fallbackReason}`);
      }
    }
  } catch (err) {
    fallbackReason = `cloud_error: ${(err as Error).message}`;
    logFallback(scopeLabel, fallbackReason);
  }

  if (cloud.length > 0) {
    const covered = new Set(cloud.map((s) => s.sourceId));
    const filled = [...cloud];
    for (const s of sources) {
      if (covered.has(s.id)) continue;
      const h = heuristicGoalSuggestion(s, catalog);
      if (h) filled.push(h);
    }
    return { suggestions: filled, targetCount: sources.length, source: "cloud" };
  }

  const heuristic = sources
    .map((s) => heuristicGoalSuggestion(s, catalog))
    .filter((s): s is GoalLinkSuggestion => !!s);
  const reason = fallbackReason ?? "cloud_unavailable_unknown";
  if (!fallbackReason) logFallback(scopeLabel, reason);
  return { suggestions: heuristic, targetCount: sources.length, source: "heuristic", fallbackReason: reason };
}

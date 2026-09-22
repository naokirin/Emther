import { extractFirstJsonObject } from "./local-model";
import { runCloudChat } from "./cloud-chat";
import { listSuggestions } from "./suggestion-store";
import { getTheme, listAdoptedThemes, toThemeView, type OrgTheme } from "./theme-store";
import { listGoals } from "./org-context-store/index";
import { unmaskNames } from "./people-directory";
import { isSuggestionStrategyUnlinked, type GoalLinkSuggestion, type Suggestion, type SuggestionStrategyLinkSuggestion } from "./types";
import { isLocalRerankEnabled, scoreQueryDocuments } from "./reranker";

export type { GoalLinkSuggestion, SuggestionStrategyLinkSuggestion };

export type LinkSuggestSource = "cloud" | "heuristic";

export type LinkSuggestResult<T> = {
  suggestions: T[];
  targetCount: number;
  source: LinkSuggestSource;
  /** source が heuristic のとき、フォールバック理由（診断・UI 表示用） */
  fallbackReason?: string;
};

// 戦略未接続の提案 → テーマ を AI（失敗時はヒューリスティック）で提案する。
// 永続化はしない（HITL）。採用は既存 PATCH（suggestion themeId）。
// クラウドへ渡す本文はストア上のマスク済みテキストのままにする（toThemeView で実名復元すると
// assertNoRealNamesLeaked で即失敗し、類似度フォールバックに落ちる）。

const SUGGESTION_SYSTEM_PROMPT = [
  "あなたは組織の階層接続（テーマ ↔ 提案）を提案するツールです。説明や前置き・Markdownフェンスは書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"suggestions":[{"suggestionId":string,"themeId":string|null,"rationale":string}]}',
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

// 提案の内容源: detail（AIの結論・根拠・ロジック）があればそれを、無ければ直近メモを使う
// （旧issue-store経由のcharterは常に空だったため、リンク候補の材料として機能していなかった。
// Suggestion直結にする際に実際に内容が乗るよう修正した）。
function suggestionContentHaystack(suggestion: Suggestion): string {
  const parts = [suggestion.title];
  if (suggestion.detail) {
    parts.push(suggestion.detail.conclusion, suggestion.detail.logic, ...suggestion.detail.facts);
  }
  const latestMemo = suggestion.memos.at(-1)?.text;
  if (latestMemo) parts.push(latestMemo);
  return parts.filter(Boolean).join(" ");
}

function labelSuggestionLink(
  suggestion: Suggestion,
  themeId: string | null,
  rationale: string,
  themes: OrgTheme[],
): SuggestionStrategyLinkSuggestion | null {
  const theme = themeId ? themes.find((t) => t.id === themeId) : undefined;
  const resolvedThemeId = theme ? theme.id : null;
  if (!resolvedThemeId) return null;
  return {
    suggestionId: suggestion.id,
    suggestionTitle: unmaskNames(suggestion.title),
    themeId: resolvedThemeId,
    rationale: rationale.trim() || "内容の類似から候補を選びました",
    labels: { theme: theme ? toThemeView(theme).title : undefined },
  };
}

async function scoreHeuristicPairs(query: string, candidates: string[]): Promise<number[] | null> {
  if (!isLocalRerankEnabled() || candidates.length === 0) return null;
  try {
    return await scoreQueryDocuments(query, candidates);
  } catch {
    return null;
  }
}

async function heuristicSuggestionLink(
  suggestion: Suggestion,
  themes: OrgTheme[],
): Promise<SuggestionStrategyLinkSuggestion | null> {
  const hay = suggestionContentHaystack(suggestion);
  const themeTexts = themes.map((t) => [t.title, t.summary, t.rationale].join(" "));
  const rerankScores = await scoreHeuristicPairs(hay, themeTexts);
  const rankedThemes = themes
    .map((t, i) => ({
      t,
      score: rerankScores ? (rerankScores[i] ?? Number.NEGATIVE_INFINITY) : overlapScore(hay, themeTexts[i]),
    }))
    .filter((x) => (rerankScores ? Number.isFinite(x.score) : x.score > 0.08))
    .sort((a, b) => b.score - a.score);

  const themeId: string | null = rankedThemes[0]?.t.id ?? null;

  if (!themeId) {
    if (themes.length === 1) {
      const only = themes[0];
      return labelSuggestionLink(
        suggestion,
        only.id,
        "唯一の採用テーマへ暫定リンクを提案します（内容照合が弱いため要確認）",
        themes,
      );
    }
    return null;
  }

  const rationale = rerankScores
    ? "提案内容とテーマの関連スコアから候補を選びました"
    : "提案内容とテーマ文言の類似から候補を選びました";
  return labelSuggestionLink(suggestion, themeId, rationale, themes);
}

function parseSuggestionCloud(
  raw: unknown,
  targets: Suggestion[],
  themes: OrgTheme[],
): {
  suggestions: SuggestionStrategyLinkSuggestion[];
  stats: { raw: number; matchedSuggestion: number; labeled: number; nullTheme: number; unknownTheme: number };
} {
  const stats = { raw: 0, matchedSuggestion: 0, labeled: 0, nullTheme: 0, unknownTheme: 0 };
  if (!raw || typeof raw !== "object") return { suggestions: [], stats };
  const suggestions = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return { suggestions: [], stats };
  const byId = new Map(targets.map((s) => [s.id, s]));
  const out: SuggestionStrategyLinkSuggestion[] = [];
  for (const item of suggestions) {
    stats.raw++;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const suggestionId = typeof row.suggestionId === "string" ? row.suggestionId : "";
    const suggestion = byId.get(suggestionId);
    if (!suggestion) continue;
    stats.matchedSuggestion++;
    const themeIdRaw = typeof row.themeId === "string" ? row.themeId : null;
    if (!themeIdRaw) stats.nullTheme++;
    if (themeIdRaw && !themes.some((t) => t.id === themeIdRaw)) stats.unknownTheme++;
    const rationale = typeof row.rationale === "string" ? row.rationale : "";
    const labeled = labelSuggestionLink(suggestion, themeIdRaw, rationale, themes);
    if (labeled) {
      stats.labeled++;
      out.push(labeled);
    }
  }
  return { suggestions: out, stats };
}

function selectUnlinkedSuggestions(suggestionIds?: string[]): Suggestion[] {
  const filter = suggestionIds?.length ? new Set(suggestionIds) : null;
  return listSuggestions()
    .filter((s) => !s.archivedAt && s.reviewStatus !== "done" && isSuggestionStrategyUnlinked(s))
    .filter((s) => (filter ? filter.has(s.id) : true))
    .slice(0, 15);
}

export async function suggestSuggestionStrategyLinks(opts?: {
  suggestionIds?: string[];
}): Promise<LinkSuggestResult<SuggestionStrategyLinkSuggestion>> {
  const targets = selectUnlinkedSuggestions(opts?.suggestionIds);
  const themes = listAdoptedThemes();
  if (targets.length === 0 || themes.length === 0) {
    const fallbackReason = targets.length === 0 ? "no_unlinked_suggestions" : "no_theme_candidates";
    logFallback("suggestion→strategy", fallbackReason);
    return { suggestions: [], targetCount: targets.length, source: "heuristic", fallbackReason };
  }

  // 提案 / テーマともマスク済みのまま（実名復元すると送信ガードで即失敗する）
  const suggestionBlock = targets
    .map((s) => {
      return [`- suggestionId=${s.id}`, `  title: ${s.title}`, `  内容: ${suggestionContentHaystack(s)}`].join("\n");
    })
    .join("\n");
  const themeBlock = themes
    .map((t) => `- themeId=${t.id} ${t.title} — ${t.summary}`)
    .join("\n");

  let cloud: SuggestionStrategyLinkSuggestion[] = [];
  let fallbackReason: string | undefined;
  try {
    const content = await runCloudChat(
      SUGGESTION_SYSTEM_PROMPT,
      ["戦略未接続の提案:", suggestionBlock, "", "採用テーマ候補:", themeBlock].join("\n"),
    );
    const jsonText = extractFirstJsonObject(content);
    if (!jsonText) {
      fallbackReason = "cloud_response_had_no_json";
      console.warn(
        `[link-suggest] suggestion→strategy: ${fallbackReason} (responseChars=${content.length})`,
      );
    } else {
      try {
        const parsed = parseSuggestionCloud(JSON.parse(jsonText), targets, themes);
        cloud = parsed.suggestions;
        if (cloud.length === 0) {
          fallbackReason = `cloud_json_parsed_but_no_valid_suggestions(raw=${parsed.stats.raw},matchedSuggestion=${parsed.stats.matchedSuggestion},labeled=${parsed.stats.labeled},nullTheme=${parsed.stats.nullTheme},unknownTheme=${parsed.stats.unknownTheme})`;
          console.warn(`[link-suggest] suggestion→strategy: ${fallbackReason}`);
        }
      } catch (err) {
        fallbackReason = `cloud_json_parse_error: ${(err as Error).message}`;
        console.warn(`[link-suggest] suggestion→strategy: ${fallbackReason}`);
      }
    }
  } catch (err) {
    fallbackReason = `cloud_error: ${(err as Error).message}`;
    logFallback("suggestion→strategy", fallbackReason);
  }

  if (cloud.length > 0) {
    const covered = new Set(cloud.map((s) => s.suggestionId));
    const filled = [...cloud];
    for (const s of targets) {
      if (covered.has(s.id)) continue;
      const h = await heuristicSuggestionLink(s, themes);
      if (h) filled.push(h);
    }
    return { suggestions: filled, targetCount: targets.length, source: "cloud" };
  }

  const heuristic = (
    await Promise.all(targets.map((s) => heuristicSuggestionLink(s, themes)))
  ).filter((s): s is SuggestionStrategyLinkSuggestion => !!s);
  const reason = fallbackReason ?? "cloud_unavailable_unknown";
  if (!fallbackReason) logFallback("suggestion→strategy", reason);
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

async function heuristicGoalSuggestion(
  src: GoalLinkSourceRaw,
  catalog: GoalCatalogEntry[],
): Promise<GoalLinkSuggestion | null> {
  const texts = catalog.map((g) => g.text);
  const rerankScores = await scoreHeuristicPairs(src.hay, texts);
  const ranked = catalog
    .map((g, i) => ({
      g,
      score: rerankScores ? (rerankScores[i] ?? Number.NEGATIVE_INFINITY) : overlapScore(src.hay, g.text),
    }))
    .filter((x) => (rerankScores ? Number.isFinite(x.score) : x.score > 0.08))
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
  const rationale = rerankScores
    ? "内容の関連スコアからGoal候補を選びました"
    : "内容の類似からGoal候補を選びました";
  return labelGoalSuggestion(src.id, goalIds, rationale, catalog);
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
      const h = await heuristicGoalSuggestion(s, catalog);
      if (h) filled.push(h);
    }
    return { suggestions: filled, targetCount: sources.length, source: "cloud" };
  }

  const heuristic = (
    await Promise.all(sources.map((s) => heuristicGoalSuggestion(s, catalog)))
  ).filter((s): s is GoalLinkSuggestion => !!s);
  const reason = fallbackReason ?? "cloud_unavailable_unknown";
  if (!fallbackReason) logFallback(scopeLabel, reason);
  return { suggestions: heuristic, targetCount: sources.length, source: "heuristic", fallbackReason: reason };
}

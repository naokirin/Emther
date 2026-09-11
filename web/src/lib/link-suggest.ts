import { extractFirstJsonObject } from "@/lib/local-model";
import { runCloudChat } from "@/lib/cloud-chat";
import { listIssues } from "@/lib/issue-store";
import { listObjectives, toObjectiveView } from "@/lib/org-context-store";
import { listAdoptedThemes, toThemeView, type OrgTheme } from "@/lib/theme-store";
import {
  isIssueStrategyUnlinked,
  isThemeOkrUnlinked,
  type Issue,
  type IssueStrategyLinkSuggestion,
  type ThemeOkrLinkSuggestion,
} from "@/lib/types";

export type { ThemeOkrLinkSuggestion, IssueStrategyLinkSuggestion };
export { isThemeOkrUnlinked };

// docs/value_hierarchy_and_flow.md §2 / §6.1。
// OKR未リンクの採用テーマ → Objective/KR、戦略未接続の親 Issue → テーマ/KR を AI（失敗時はヒューリスティック）で提案する。
// 永続化はしない（HITL）。採用は既存 PATCH（theme action:link / issue themeId·keyResultId）。

const THEME_SYSTEM_PROMPT = [
  "あなたは組織の階層接続（OKR ↔ テーマ）を提案するツールです。説明や前置き・Markdownフェンスは書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"suggestions":[{"themeId":string,"objectiveIds":string[],"keyResultIds":string[],"rationale":string}]}',
  "objectiveIds / keyResultIds は入力リストにある ID のみを使うこと。無い場合は空配列。",
  "各テーマに最も関連する Objective を最大2、Key Result を最大3まで。無理に全部埋めない。",
  "rationale は日本語で1文。入力に無い事実を捏造しない。",
].join("\n");

const ISSUE_SYSTEM_PROMPT = [
  "あなたは組織の階層接続（テーマ / Key Result ↔ Issue）を提案するツールです。説明や前置き・Markdownフェンスは書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"suggestions":[{"issueId":string,"themeId":string|null,"keyResultId":string|null,"rationale":string}]}',
  "themeId / keyResultId は入力リストにある ID のみ。どちらも付けられないときは両方 null。",
  "themeId か keyResultId の少なくとも一方を付けられるなら付ける。両方あると望ましい。",
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
    if (/[\u3040-\u30ff\u3400-\u9fff]/.test(bi)) tokens.add(bi);
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

type OkrCatalog = {
  objectives: Array<{ id: string; title: string; text: string }>;
  keyResults: Array<{ id: string; title: string; objectiveId: string; objectiveTitle: string; text: string }>;
};

function buildOkrCatalog(): OkrCatalog {
  const objectives = listObjectives().map(toObjectiveView);
  return {
    objectives: objectives.map((o) => ({
      id: o.id,
      title: o.title,
      text: [o.title, o.note ?? ""].join(" "),
    })),
    keyResults: objectives.flatMap((o) =>
      o.keyResults.map((kr) => ({
        id: kr.id,
        title: kr.title,
        objectiveId: o.id,
        objectiveTitle: o.title,
        text: `${o.title} ${kr.title}`,
      })),
    ),
  };
}

function labelThemeSuggestion(
  theme: OrgTheme,
  objectiveIds: string[],
  keyResultIds: string[],
  rationale: string,
  catalog: OkrCatalog,
): ThemeOkrLinkSuggestion | null {
  const validObj = objectiveIds.filter((id) => catalog.objectives.some((o) => o.id === id));
  const validKr = keyResultIds.filter((id) => catalog.keyResults.some((k) => k.id === id));
  if (validObj.length === 0 && validKr.length === 0) return null;
  return {
    themeId: theme.id,
    themeTitle: toThemeView(theme).title,
    objectiveIds: validObj,
    keyResultIds: validKr,
    rationale: rationale.trim() || "内容の類似から候補を選びました",
    labels: {
      objectives: validObj.map((id) => catalog.objectives.find((o) => o.id === id)!.title),
      keyResults: validKr.map((id) => {
        const kr = catalog.keyResults.find((k) => k.id === id)!;
        return `${kr.objectiveTitle} ＞ ${kr.title}`;
      }),
    },
  };
}

function labelIssueSuggestion(
  issue: Issue,
  themeId: string | null,
  keyResultId: string | null,
  rationale: string,
  themes: OrgTheme[],
  catalog: OkrCatalog,
): IssueStrategyLinkSuggestion | null {
  const theme = themeId ? themes.find((t) => t.id === themeId) : undefined;
  const kr = keyResultId ? catalog.keyResults.find((k) => k.id === keyResultId) : undefined;
  const resolvedThemeId = theme ? theme.id : null;
  const resolvedKrId = kr ? kr.id : null;
  if (!resolvedThemeId && !resolvedKrId) return null;
  return {
    issueId: issue.id,
    issueTitle: issue.title,
    themeId: resolvedThemeId,
    keyResultId: resolvedKrId,
    rationale: rationale.trim() || "内容の類似から候補を選びました",
    labels: {
      theme: theme ? toThemeView(theme).title : undefined,
      keyResult: kr ? `${kr.objectiveTitle} ＞ ${kr.title}` : undefined,
    },
  };
}

function heuristicThemeSuggestion(theme: OrgTheme, catalog: OkrCatalog): ThemeOkrLinkSuggestion | null {
  const hay = [theme.title, theme.summary, theme.rationale, theme.suggestedDirection ?? ""].join(" ");
  const rankedObj = catalog.objectives
    .map((o) => ({ o, score: overlapScore(hay, o.text) }))
    .filter((x) => x.score > 0.08)
    .sort((a, b) => b.score - a.score);
  const rankedKr = catalog.keyResults
    .map((k) => ({ k, score: overlapScore(hay, k.text) }))
    .filter((x) => x.score > 0.08)
    .sort((a, b) => b.score - a.score);

  const keyResultIds = rankedKr.slice(0, 2).map((x) => x.k.id);
  const objectiveIdsFromKr = keyResultIds.map(
    (id) => catalog.keyResults.find((k) => k.id === id)!.objectiveId,
  );
  const objectiveIds = Array.from(
    new Set([...objectiveIdsFromKr, ...rankedObj.slice(0, 1).map((x) => x.o.id)]),
  ).slice(0, 2);

  if (objectiveIds.length === 0 && keyResultIds.length === 0) {
    // 類似が取れないときも、唯一の Objective があれば弱く提案する
    if (catalog.objectives.length === 1) {
      const only = catalog.objectives[0];
      const onlyKrs = catalog.keyResults.filter((k) => k.objectiveId === only.id).slice(0, 1);
      return labelThemeSuggestion(
        theme,
        [only.id],
        onlyKrs.map((k) => k.id),
        "唯一の Objective へ暫定リンクを提案します（内容照合が弱いため要確認）",
        catalog,
      );
    }
    return null;
  }

  return labelThemeSuggestion(
    theme,
    objectiveIds,
    keyResultIds,
    "タイトル・要約と OKR 文言の類似から候補を選びました",
    catalog,
  );
}

function heuristicIssueSuggestion(
  issue: Issue,
  themes: OrgTheme[],
  catalog: OkrCatalog,
): IssueStrategyLinkSuggestion | null {
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

  const rankedKr = catalog.keyResults
    .map((k) => ({ k, score: overlapScore(hay, k.text) }))
    .filter((x) => x.score > 0.08)
    .sort((a, b) => b.score - a.score);

  const themeId: string | null = rankedThemes[0]?.t.id ?? null;
  let keyResultId: string | null = rankedKr[0]?.k.id ?? null;

  if (themeId) {
    const theme = themes.find((t) => t.id === themeId)!;
    if (!keyResultId && theme.keyResultIds.length > 0) {
      keyResultId = theme.keyResultIds[0];
    }
  }

  if (!themeId && !keyResultId) {
    if (themes.length === 1) {
      const only = themes[0];
      return labelIssueSuggestion(
        issue,
        only.id,
        only.keyResultIds[0] ?? null,
        "唯一の採用テーマへ暫定リンクを提案します（内容照合が弱いため要確認）",
        themes,
        catalog,
      );
    }
    return null;
  }

  return labelIssueSuggestion(
    issue,
    themeId,
    keyResultId,
    "Issue 内容とテーマ／KR 文言の類似から候補を選びました",
    themes,
    catalog,
  );
}

function parseThemeCloud(
  raw: unknown,
  targets: OrgTheme[],
  catalog: OkrCatalog,
): ThemeOkrLinkSuggestion[] {
  if (!raw || typeof raw !== "object") return [];
  const suggestions = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return [];
  const byId = new Map(targets.map((t) => [t.id, t]));
  const out: ThemeOkrLinkSuggestion[] = [];
  for (const item of suggestions) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const themeId = typeof row.themeId === "string" ? row.themeId : "";
    const theme = byId.get(themeId);
    if (!theme) continue;
    const objectiveIds = Array.isArray(row.objectiveIds)
      ? row.objectiveIds.filter((id): id is string => typeof id === "string")
      : [];
    const keyResultIds = Array.isArray(row.keyResultIds)
      ? row.keyResultIds.filter((id): id is string => typeof id === "string")
      : [];
    const rationale = typeof row.rationale === "string" ? row.rationale : "";
    const labeled = labelThemeSuggestion(theme, objectiveIds, keyResultIds, rationale, catalog);
    if (labeled) out.push(labeled);
  }
  return out;
}

function parseIssueCloud(
  raw: unknown,
  targets: Issue[],
  themes: OrgTheme[],
  catalog: OkrCatalog,
): IssueStrategyLinkSuggestion[] {
  if (!raw || typeof raw !== "object") return [];
  const suggestions = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return [];
  const byId = new Map(targets.map((i) => [i.id, i]));
  const out: IssueStrategyLinkSuggestion[] = [];
  for (const item of suggestions) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const issueId = typeof row.issueId === "string" ? row.issueId : "";
    const issue = byId.get(issueId);
    if (!issue) continue;
    const themeId = typeof row.themeId === "string" ? row.themeId : null;
    const keyResultId = typeof row.keyResultId === "string" ? row.keyResultId : null;
    const rationale = typeof row.rationale === "string" ? row.rationale : "";
    const labeled = labelIssueSuggestion(issue, themeId, keyResultId, rationale, themes, catalog);
    if (labeled) out.push(labeled);
  }
  return out;
}

function selectUnlinkedThemes(themeIds?: string[]): OrgTheme[] {
  const adopted = listAdoptedThemes();
  const filter = themeIds?.length ? new Set(themeIds) : null;
  return adopted
    .filter((t) => isThemeOkrUnlinked(t))
    .filter((t) => (filter ? filter.has(t.id) : true))
    .slice(0, 10);
}

function selectUnlinkedIssues(issueIds?: string[]): Issue[] {
  const filter = issueIds?.length ? new Set(issueIds) : null;
  return listIssues()
    .filter((i) => !i.archived && i.status !== "done" && !i.parentId && isIssueStrategyUnlinked(i))
    .filter((i) => (filter ? filter.has(i.id) : true))
    .slice(0, 15);
}

export async function suggestThemeOkrLinks(opts?: {
  themeIds?: string[];
}): Promise<{
  suggestions: ThemeOkrLinkSuggestion[];
  targetCount: number;
  source: "cloud" | "heuristic";
}> {
  const targets = selectUnlinkedThemes(opts?.themeIds);
  const catalog = buildOkrCatalog();
  if (targets.length === 0 || (catalog.objectives.length === 0 && catalog.keyResults.length === 0)) {
    return { suggestions: [], targetCount: targets.length, source: "heuristic" };
  }

  const themeBlock = targets
    .map((t) => {
      const v = toThemeView(t);
      return `- themeId=${t.id}\n  title: ${v.title}\n  summary: ${v.summary}\n  rationale: ${v.rationale}`;
    })
    .join("\n");
  const okrBlock = catalog.objectives
    .map((o) => {
      const krs = catalog.keyResults
        .filter((k) => k.objectiveId === o.id)
        .map((k) => `    - keyResultId=${k.id} ${k.title}`)
        .join("\n");
      return `- objectiveId=${o.id} ${o.title}${krs ? `\n${krs}` : ""}`;
    })
    .join("\n");

  let cloud: ThemeOkrLinkSuggestion[] = [];
  try {
    const content = await runCloudChat(
      THEME_SYSTEM_PROMPT,
      ["未リンクの採用テーマ:", themeBlock, "", "リンク先候補の OKR:", okrBlock].join("\n"),
    );
    const jsonText = extractFirstJsonObject(content);
    if (jsonText) cloud = parseThemeCloud(JSON.parse(jsonText), targets, catalog);
  } catch {
    cloud = [];
  }

  if (cloud.length > 0) {
    const covered = new Set(cloud.map((s) => s.themeId));
    const filled = [...cloud];
    for (const t of targets) {
      if (covered.has(t.id)) continue;
      const h = heuristicThemeSuggestion(t, catalog);
      if (h) filled.push(h);
    }
    return { suggestions: filled, targetCount: targets.length, source: "cloud" };
  }

  const heuristic = targets
    .map((t) => heuristicThemeSuggestion(t, catalog))
    .filter((s): s is ThemeOkrLinkSuggestion => !!s);
  return { suggestions: heuristic, targetCount: targets.length, source: "heuristic" };
}

export async function suggestIssueStrategyLinks(opts?: {
  issueIds?: string[];
}): Promise<{
  suggestions: IssueStrategyLinkSuggestion[];
  targetCount: number;
  source: "cloud" | "heuristic";
}> {
  const targets = selectUnlinkedIssues(opts?.issueIds);
  const themes = listAdoptedThemes();
  const catalog = buildOkrCatalog();
  if (targets.length === 0 || (themes.length === 0 && catalog.keyResults.length === 0)) {
    return { suggestions: [], targetCount: targets.length, source: "heuristic" };
  }

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
    .map((t) => {
      const v = toThemeView(t);
      return `- themeId=${t.id} ${v.title} — ${v.summary}`;
    })
    .join("\n");
  const krBlock = catalog.keyResults
    .map((k) => `- keyResultId=${k.id} ${k.objectiveTitle} ＞ ${k.title}`)
    .join("\n");

  let cloud: IssueStrategyLinkSuggestion[] = [];
  try {
    const content = await runCloudChat(
      ISSUE_SYSTEM_PROMPT,
      [
        "戦略未接続の親 Issue:",
        issueBlock,
        "",
        "採用テーマ候補:",
        themeBlock || "(なし)",
        "",
        "Key Result 候補:",
        krBlock || "(なし)",
      ].join("\n"),
    );
    const jsonText = extractFirstJsonObject(content);
    if (jsonText) cloud = parseIssueCloud(JSON.parse(jsonText), targets, themes, catalog);
  } catch {
    cloud = [];
  }

  if (cloud.length > 0) {
    const covered = new Set(cloud.map((s) => s.issueId));
    const filled = [...cloud];
    for (const i of targets) {
      if (covered.has(i.id)) continue;
      const h = heuristicIssueSuggestion(i, themes, catalog);
      if (h) filled.push(h);
    }
    return { suggestions: filled, targetCount: targets.length, source: "cloud" };
  }

  const heuristic = targets
    .map((i) => heuristicIssueSuggestion(i, themes, catalog))
    .filter((s): s is IssueStrategyLinkSuggestion => !!s);
  return { suggestions: heuristic, targetCount: targets.length, source: "heuristic" };
}

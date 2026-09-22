import type { Proposal } from "./agent-runtime/types";
import {
  CONFIRM_PRIORITY_META,
  SUGGESTION_REVIEW_STATUS_META,
  type ConfirmPriority,
  type Suggestion,
  type SuggestionReviewStatus,
} from "./types";

/** docs/suggestion_export.md Phase B の列 ID。 */
export type SuggestionExportColumnId =
  | "title"
  | "conclusion"
  | "facts"
  | "logic"
  | "advice"
  | "memos"
  | "theme"
  | "team"
  | "confirmPriority"
  | "reviewStatus"
  | "reviewDueAt"
  | "id"
  | "url"
  | "aiConclusion"
  | "aiFacts"
  | "aiLogic"
  | "aiAdvice"
  | "aiChat";

export type SuggestionExportColumnDef = {
  id: SuggestionExportColumnId;
  header: string;
};

export const SUGGESTION_EXPORT_COLUMNS: SuggestionExportColumnDef[] = [
  { id: "title", header: "タイトル" },
  { id: "conclusion", header: "結論" },
  { id: "facts", header: "根拠" },
  { id: "logic", header: "判断ロジック" },
  { id: "advice", header: "進め方のアドバイス" },
  { id: "memos", header: "メモ" },
  { id: "theme", header: "テーマ" },
  { id: "team", header: "チーム" },
  { id: "confirmPriority", header: "確認優先度" },
  { id: "reviewStatus", header: "確認状態" },
  { id: "reviewDueAt", header: "確認期日" },
  { id: "id", header: "Emther ID" },
  { id: "url", header: "Emther URL" },
  { id: "aiConclusion", header: "AI結論" },
  { id: "aiFacts", header: "AI根拠" },
  { id: "aiLogic", header: "AI判断ロジック" },
  { id: "aiAdvice", header: "AI進め方のアドバイス" },
  { id: "aiChat", header: "AI壁打ち" },
];

/** βの既定: よく貼る列だけ・Notion DB / Sheets 向けの短い並び。 */
export const DEFAULT_SUGGESTION_EXPORT_COLUMN_IDS: SuggestionExportColumnId[] = [
  "title",
  "conclusion",
  "theme",
  "confirmPriority",
  "id",
];

/** Markdown 1件コピー時／表の AI* 列で使う、判断・提案／壁打ちの AI 側参照。 */
export type SuggestionExportAgentSource = {
  /** 既定: 判断・提案（Agent） */
  heading?: string;
  agentName?: string;
  proposal?: Pick<
    Proposal,
    "conclusion" | "facts" | "logic" | "advice" | "expansions" | "challenges" | "rejectedAlternatives"
  >;
  /** Agent Run のログ（壁打ち用）。channel は agent / meta 等。 */
  log?: Array<{ channel: string; text: string }>;
};

export type SuggestionExportLookups = {
  themeTitleById?: Record<string, string>;
  teamNameById?: Record<string, string>;
  /** 例: http://127.0.0.1:3000。末尾スラッシュは除去して URL を組み立てる。 */
  appOrigin?: string;
  /** 提案 ID → 紐づく Agent Run（判断・提案／壁打ち）。表の AI* 列で参照する。 */
  agentSourceBySuggestionId?: Record<string, SuggestionExportAgentSource>;
};

export type SuggestionMarkdownExportInput = Pick<
  Suggestion,
  "id" | "title" | "confirmPriority" | "reviewStatus" | "detail" | "memos" | "themeId" | "teamId"
>;

export type SuggestionMarkdownExportOptions = SuggestionExportLookups & {
  agentSource?: SuggestionExportAgentSource;
};

function priorityLabel(p: ConfirmPriority): string {
  return CONFIRM_PRIORITY_META[p]?.label ?? p;
}

function statusLabel(s: SuggestionReviewStatus): string {
  return SUGGESTION_REVIEW_STATUS_META[s]?.label ?? s;
}

function formatDueAt(ts: number | undefined): string {
  if (ts === undefined) return "";
  return new Date(ts).toLocaleDateString("ja-JP");
}

export function buildSuggestionUrl(id: string, appOrigin?: string): string {
  const path = `/suggestions/${id}`;
  if (!appOrigin) return path;
  return `${appOrigin.replace(/\/$/, "")}${path}`;
}

/** Agent Run から表／Markdown 共用の AI 参照を作る。 */
export function agentSourceFromRun(
  run: {
    agentName: string;
    proposal?: SuggestionExportAgentSource["proposal"];
    log: Array<{ channel: string; text: string }>;
  },
  heading?: string,
): SuggestionExportAgentSource {
  return {
    ...(heading ? { heading } : {}),
    agentName: run.agentName,
    ...(run.proposal ? { proposal: run.proposal } : {}),
    log: run.log,
  };
}

/** TSV / 表セル用。タブ・改行を空白に潰す。 */
export function sanitizeExportCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

/** RunDetail の壁打ち表示と同じく、構造化ブロックを除いた対話寄せテキストにする。 */
function stripStructuredBlocks(text: string): string {
  return text.replace(/```(?:yield|proposal|consult|action_items|charter|sub_issues)\s*\n?[\s\S]*?```/g, "").trim();
}

type ExportChatTurn = { kind: "user" | "ai" | "note"; text: string };

export function buildExportChatTurns(log: Array<{ channel: string; text: string }>): ExportChatTurn[] {
  return log.flatMap((line): ExportChatTurn[] => {
    if (line.channel === "agent") {
      const text = stripStructuredBlocks(line.text);
      return text ? [{ kind: "ai", text }] : [];
    }
    if (line.channel === "meta" && line.text.startsWith("タスクを受理: ")) {
      return [{ kind: "user", text: line.text.replace(/^タスクを受理: /, "") }];
    }
    if (line.channel === "meta" && line.text.startsWith("EMからの入力: ")) {
      return [{ kind: "user", text: line.text.replace(/^EMからの入力: /, "") }];
    }
    return [{ kind: "note", text: line.text }];
  });
}

function appendProposalSections(
  lines: string[],
  proposal: NonNullable<SuggestionExportAgentSource["proposal"]>,
  headingPrefix: string,
): void {
  if (proposal.conclusion) {
    lines.push(`${headingPrefix}結論`, proposal.conclusion, "");
  }
  if (proposal.facts.length > 0) {
    lines.push(`${headingPrefix}根拠`, ...proposal.facts.map((f) => `- ${f}`), "");
  }
  if (proposal.logic) {
    lines.push(`${headingPrefix}判断ロジック`, proposal.logic, "");
  }
  if (proposal.expansions?.length) {
    lines.push(`${headingPrefix}視点の広がり（Expand）`, ...proposal.expansions.map((e) => `- ${e}`), "");
  }
  if (proposal.challenges?.length) {
    lines.push(`${headingPrefix}前提への問い（Challenge）`, ...proposal.challenges.map((c) => `- ${c}`), "");
  }
  if (proposal.advice) {
    lines.push(`${headingPrefix}進め方のアドバイス`, proposal.advice, "");
  }
  if (proposal.rejectedAlternatives?.length) {
    lines.push(
      `${headingPrefix}棄却した代替案`,
      ...proposal.rejectedAlternatives.map((r) => {
        const reason = r.reason ? ` — ${r.reason}` : "";
        return `- ${r.option}${reason}`;
      }),
      "",
    );
  }
}

function formatAgentSourceAppendix(source: SuggestionExportAgentSource): string {
  const lines: string[] = [];
  const heading = source.heading?.trim() || "判断・提案（Agent）";
  lines.push(`## 参照: AI出力（${heading}）`, "");
  lines.push(
    "> 提案の詳細は後から編集されている場合があります。以下は紐づく Agent Run 側の出力です。",
    "",
  );
  if (source.agentName) {
    lines.push(`Agent: ${source.agentName}`, "");
  }

  if (source.proposal) {
    lines.push("### 判断・提案", "");
    appendProposalSections(lines, source.proposal, "#### ");
  }

  const turns = source.log?.length ? buildExportChatTurns(source.log) : [];
  const dialogue = turns.filter((t) => t.kind === "user" || t.kind === "ai");
  if (dialogue.length > 0) {
    lines.push("### 壁打ち", "");
    for (const turn of dialogue) {
      const who = turn.kind === "user" ? "EM" : (source.agentName ? source.agentName : "AI");
      lines.push(`**${who}:**`, turn.text, "");
    }
  }

  // proposal も壁打ちも無いなら見出しだけ出さない
  if (!source.proposal && dialogue.length === 0) return "";

  return lines.join("\n").trimEnd() + "\n";
}

export function formatSuggestionMarkdown(
  s: SuggestionMarkdownExportInput,
  options: SuggestionMarkdownExportOptions = {},
): string {
  const lines: string[] = [`# ${s.title}`, ""];

  if (s.detail?.conclusion) {
    lines.push("## 結論", s.detail.conclusion, "");
  }
  if (s.detail?.facts?.length) {
    lines.push("## 根拠", ...s.detail.facts.map((f) => `- ${f}`), "");
  }
  if (s.detail?.logic) {
    lines.push("## 判断ロジック", s.detail.logic, "");
  }
  if (s.detail?.expansions?.length) {
    lines.push("## 視点の広がり（Expand）", ...s.detail.expansions.map((e) => `- ${e}`), "");
  }
  if (s.detail?.challenges?.length) {
    lines.push("## 前提への問い（Challenge）", ...s.detail.challenges.map((c) => `- ${c}`), "");
  }
  if (s.detail?.advice) {
    lines.push("## 進め方のアドバイス", s.detail.advice, "");
  }
  if (s.memos.length > 0) {
    lines.push("## メモ", ...s.memos.map((m) => `- ${m.text}`), "");
  }

  const meta: string[] = [];
  if (s.themeId) {
    meta.push(`Theme: ${options.themeTitleById?.[s.themeId] ?? s.themeId}`);
  }
  if (s.teamId) {
    meta.push(`Team: ${options.teamNameById?.[s.teamId] ?? s.teamId}`);
  }
  meta.push(`Confirm: ${priorityLabel(s.confirmPriority)} / ${statusLabel(s.reviewStatus)}`);
  meta.push(`Emther ID: ${s.id}`);
  meta.push(`Emther URL: ${buildSuggestionUrl(s.id, options.appOrigin)}`);
  lines.push("---", ...meta, "");

  let body = lines.join("\n").trimEnd() + "\n";
  if (options.agentSource) {
    const appendix = formatAgentSourceAppendix(options.agentSource);
    if (appendix) body += "\n" + appendix;
  }
  return body;
}

export function resolveExportColumns(
  enabledOrderedIds: SuggestionExportColumnId[],
): SuggestionExportColumnDef[] {
  const byId = new Map(SUGGESTION_EXPORT_COLUMNS.map((c) => [c.id, c]));
  const seen = new Set<SuggestionExportColumnId>();
  const resolved: SuggestionExportColumnDef[] = [];
  for (const id of enabledOrderedIds) {
    if (seen.has(id)) continue;
    const def = byId.get(id);
    if (!def) continue;
    seen.add(id);
    resolved.push(def);
  }
  return resolved;
}

function joinList(items: string[], sep = " / "): string {
  return items.map((t) => t.trim()).filter(Boolean).join(sep);
}

function formatAiChatCell(source: SuggestionExportAgentSource | undefined): string {
  if (!source?.log?.length) return "";
  const turns = buildExportChatTurns(source.log).filter((t) => t.kind === "user" || t.kind === "ai");
  if (turns.length === 0) return "";
  const agent = source.agentName?.trim() || "AI";
  return turns
    .map((t) => `${t.kind === "user" ? "EM" : agent}: ${t.text}`)
    .join(" | ");
}

function agentSourceFor(s: Suggestion, lookups: SuggestionExportLookups): SuggestionExportAgentSource | undefined {
  return lookups.agentSourceBySuggestionId?.[s.id];
}

function cellValue(
  s: Suggestion,
  columnId: SuggestionExportColumnId,
  lookups: SuggestionExportLookups,
): string {
  const ai = agentSourceFor(s, lookups);
  switch (columnId) {
    case "title":
      return s.title;
    case "conclusion":
      return s.detail?.conclusion ?? "";
    case "facts":
      return joinList(s.detail?.facts ?? []);
    case "logic":
      return s.detail?.logic ?? "";
    case "advice":
      return s.detail?.advice ?? "";
    case "memos":
      return joinList(s.memos.map((m) => m.text));
    case "theme":
      return s.themeId ? (lookups.themeTitleById?.[s.themeId] ?? s.themeId) : "";
    case "team":
      return s.teamId ? (lookups.teamNameById?.[s.teamId] ?? s.teamId) : "";
    case "confirmPriority":
      return priorityLabel(s.confirmPriority);
    case "reviewStatus":
      return statusLabel(s.reviewStatus);
    case "reviewDueAt":
      return formatDueAt(s.reviewDueAt);
    case "id":
      return s.id;
    case "url":
      return buildSuggestionUrl(s.id, lookups.appOrigin);
    case "aiConclusion":
      return ai?.proposal?.conclusion ?? "";
    case "aiFacts":
      return joinList(ai?.proposal?.facts ?? []);
    case "aiLogic":
      return ai?.proposal?.logic ?? "";
    case "aiAdvice":
      return ai?.proposal?.advice ?? "";
    case "aiChat":
      return formatAiChatCell(ai);
    default: {
      const _exhaustive: never = columnId;
      return _exhaustive;
    }
  }
}

export function formatSuggestionsTsv(
  suggestions: Suggestion[],
  enabledOrderedIds: SuggestionExportColumnId[],
  lookups: SuggestionExportLookups = {},
): string {
  const cols = resolveExportColumns(enabledOrderedIds);
  if (cols.length === 0) return "";
  const header = cols.map((c) => sanitizeExportCell(c.header)).join("\t");
  const rows = suggestions.map((s) =>
    cols.map((c) => sanitizeExportCell(cellValue(s, c.id, lookups))).join("\t"),
  );
  return [header, ...rows].join("\n") + (rows.length > 0 || header ? "\n" : "");
}

/** CSV セル用。カンマ・引用符・改行を含む場合はダブルクォートで囲む。 */
export function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Phase C: 列設定どおりの CSV（Excel / Sheets / Notion DB インポート向け）。 */
export function formatSuggestionsCsv(
  suggestions: Suggestion[],
  enabledOrderedIds: SuggestionExportColumnId[],
  lookups: SuggestionExportLookups = {},
): string {
  const cols = resolveExportColumns(enabledOrderedIds);
  if (cols.length === 0) return "";
  const header = cols.map((c) => escapeCsvCell(c.header)).join(",");
  const rows = suggestions.map((s) =>
    cols.map((c) => escapeCsvCell(cellValue(s, c.id, lookups))).join(","),
  );
  // Excel が扱いやすいよう CRLF
  return [header, ...rows].join("\r\n") + (rows.length > 0 || header ? "\r\n" : "");
}

/**
 * Phase C: 範囲の提案を 1 つの Markdown ファイルに連結する。
 * 各件は Phase A と同じ詳細＋AI 参照。区切りは水平線。
 */
export function formatSuggestionsMarkdownBundle(
  suggestions: Suggestion[],
  lookups: SuggestionExportLookups = {},
): string {
  if (suggestions.length === 0) return "";
  return (
    suggestions
      .map((s) =>
        formatSuggestionMarkdown(s, {
          ...lookups,
          agentSource: lookups.agentSourceBySuggestionId?.[s.id],
        }).trimEnd(),
      )
      .join("\n\n---\n\n") + "\n"
  );
}

function escapeMarkdownTableCell(value: string): string {
  return sanitizeExportCell(value).replace(/\|/g, "\\|");
}

export function formatSuggestionsMarkdownTable(
  suggestions: Suggestion[],
  enabledOrderedIds: SuggestionExportColumnId[],
  lookups: SuggestionExportLookups = {},
): string {
  const cols = resolveExportColumns(enabledOrderedIds);
  if (cols.length === 0) return "";
  const header = `| ${cols.map((c) => escapeMarkdownTableCell(c.header)).join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const rows = suggestions.map(
    (s) => `| ${cols.map((c) => escapeMarkdownTableCell(cellValue(s, c.id, lookups))).join(" | ")} |`,
  );
  return [header, sep, ...rows].join("\n") + "\n";
}

/** localStorage から読んだ列順を正規化（未知 ID 除去・重複除去・空なら既定）。 */
export function normalizeExportColumnIds(
  ids: unknown,
  fallback: SuggestionExportColumnId[] = DEFAULT_SUGGESTION_EXPORT_COLUMN_IDS,
): SuggestionExportColumnId[] {
  if (!Array.isArray(ids)) return [...fallback];
  const valid = new Set(SUGGESTION_EXPORT_COLUMNS.map((c) => c.id));
  const out: SuggestionExportColumnId[] = [];
  const seen = new Set<SuggestionExportColumnId>();
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const id = raw as SuggestionExportColumnId;
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length > 0 ? out : [...fallback];
}

/**
 * β UI 用: 有効列の並びを変えつつ、無効列はカタログ末尾順で保持する。
 * `enabledOrdered` がそのまま出力順。`disabled` はトグル復元用。
 */
export function partitionExportColumns(
  enabledOrdered: SuggestionExportColumnId[],
): { enabled: SuggestionExportColumnId[]; disabled: SuggestionExportColumnId[] } {
  const enabled = normalizeExportColumnIds(enabledOrdered);
  const enabledSet = new Set(enabled);
  const disabled = SUGGESTION_EXPORT_COLUMNS.map((c) => c.id).filter((id) => !enabledSet.has(id));
  return { enabled, disabled };
}

/** 未選択の列をカタログ順で末尾に足し、全列を有効にする（既存の有効順は保つ）。 */
export function enableAllExportColumns(
  enabledOrdered: SuggestionExportColumnId[],
): SuggestionExportColumnId[] {
  const { enabled, disabled } = partitionExportColumns(enabledOrdered);
  return [...enabled, ...disabled];
}

export function moveExportColumn(
  enabledOrdered: SuggestionExportColumnId[],
  id: SuggestionExportColumnId,
  direction: "up" | "down",
): SuggestionExportColumnId[] {
  const next = normalizeExportColumnIds(enabledOrdered);
  const i = next.indexOf(id);
  if (i < 0) return next;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= next.length) return next;
  const swap = next[j]!;
  next[j] = next[i]!;
  next[i] = swap;
  return next;
}

export function toggleExportColumn(
  enabledOrdered: SuggestionExportColumnId[],
  id: SuggestionExportColumnId,
  on: boolean,
): SuggestionExportColumnId[] {
  const valid = new Set(SUGGESTION_EXPORT_COLUMNS.map((c) => c.id));
  if (!valid.has(id)) return normalizeExportColumnIds(enabledOrdered);
  const current = normalizeExportColumnIds(enabledOrdered);
  if (on) {
    if (current.includes(id)) return current;
    return [...current, id];
  }
  const next = current.filter((c) => c !== id);
  // 全オフは貼り付け不能になるため、最後の1列は落とせない
  return next.length > 0 ? next : current;
}

import { listRuns } from "./agent-runtime/index";
import { findByIdPrefix, isHexIdPrefix, normalizeIdKey } from "./id-prefix";
import { listSuggestions } from "./suggestion-store";
import { listJournalEntries, type JournalEntry } from "./journal-store";
import { unmaskNames } from "./people-directory";
import type { Suggestion } from "./types";

export type IdMatchKind = "suggestion" | "journal" | "run";

export type IdMatch = {
  kind: IdMatchKind;
  id: string;
  label: string;
  href: string;
};

function truncateLabel(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t || "（無題）";
  return `${t.slice(0, max)}…`;
}

// listSuggestions/listJournalEntries/listRunsはいずれも保存時のマスク済み生データ（人名が
// {{PERSON_n}}トークンのまま）を返す関数で、通常の一覧・詳細画面はtoSuggestionView/
// toJournalEntryView/toRunViewを経由してunmaskNamesを適用してから表示している。
// resolveIdPrefixはこれらのView関数を通さず生データを直接使っていたため、ここで
// 作るlabel（IdFragmentLinkのクリック候補・カスタムツールチップの表示に使われる）に
// 未解決のマスクトークンがそのまま出てしまっていた。
function suggestionMatch(suggestion: Suggestion): IdMatch {
  const title = unmaskNames(suggestion.title).trim();
  return {
    kind: "suggestion",
    id: suggestion.id,
    label: title || "（無題の提案）",
    href: `/suggestions/${suggestion.id}`,
  };
}

function journalMatch(entry: JournalEntry): IdMatch {
  const label = unmaskNames(entry.summary?.trim() || entry.rawText);
  return {
    kind: "journal",
    id: entry.id,
    label: truncateLabel(label || "（本文なし）"),
    href: `/journal?focus=${encodeURIComponent(entry.id)}`,
  };
}

function runMatch(run: { id: string; agentName: string; task: string }): IdMatch {
  const agentName = unmaskNames(run.agentName);
  const task = unmaskNames(run.task).trim();
  return {
    kind: "run",
    id: run.id,
    label: truncateLabel(`${agentName}: ${task || "（内容未記録）"}`),
    href: `/chat?runId=${encodeURIComponent(run.id)}`,
  };
}

/** プレフィックス（またはフル ID）に一致する Suggestion / Journal / Run をすべて返す。 */
export function resolveIdPrefix(prefix: string): IdMatch[] {
  if (!isHexIdPrefix(prefix)) return [];

  const suggestions = findByIdPrefix(listSuggestions(), (s) => s.id, prefix).map(suggestionMatch);
  const journals = findByIdPrefix(listJournalEntries(), (e) => e.id, prefix).map(journalMatch);
  const runs = findByIdPrefix(listRuns(), (r) => r.id, prefix).map(runMatch);

  // 完全一致を先頭に（短いプレフィックスでもフル ID 入力時は分かりやすく）
  const key = normalizeIdKey(prefix);
  const all = [...suggestions, ...journals, ...runs];
  all.sort((a, b) => {
    const aExact = normalizeIdKey(a.id) === key ? 0 : 1;
    const bExact = normalizeIdKey(b.id) === key ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    if (a.kind !== b.kind) {
      const order = { suggestion: 0, journal: 1, run: 2 } as const;
      return order[a.kind] - order[b.kind];
    }
    return a.label.localeCompare(b.label, "ja");
  });
  return all;
}

export type UniqueResolve<T> =
  | { status: "exact" | "unique"; item: T }
  | { status: "ambiguous"; items: T[] }
  | { status: "none" };

export function resolveUniqueByPrefix<T>(
  items: readonly T[],
  getId: (item: T) => string,
  idOrPrefix: string,
): UniqueResolve<T> {
  const exact = items.find((item) => getId(item) === idOrPrefix);
  if (exact) return { status: "exact", item: exact };

  if (!isHexIdPrefix(idOrPrefix)) return { status: "none" };

  const matched = findByIdPrefix(items, getId, idOrPrefix);
  if (matched.length === 1) return { status: "unique", item: matched[0] };
  if (matched.length > 1) return { status: "ambiguous", items: matched };
  return { status: "none" };
}

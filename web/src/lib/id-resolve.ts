import { listRuns } from "@/lib/agent-runtime";
import { findByIdPrefix, isHexIdPrefix, normalizeIdKey } from "@/lib/id-prefix";
import { listIssues, type Issue } from "@/lib/issue-store";
import { listJournalEntries, type JournalEntry } from "@/lib/journal-store";

export type IdMatchKind = "issue" | "journal" | "run";

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

function issueMatch(issue: Issue): IdMatch {
  return {
    kind: "issue",
    id: issue.id,
    label: issue.title.trim() || "（無題のIssue）",
    href: `/issues/${issue.id}`,
  };
}

function journalMatch(entry: JournalEntry): IdMatch {
  const label = entry.summary?.trim() || entry.rawText;
  return {
    kind: "journal",
    id: entry.id,
    label: truncateLabel(label || "（本文なし）"),
    href: `/journal?focus=${encodeURIComponent(entry.id)}`,
  };
}

function runMatch(run: { id: string; agentName: string; task: string }): IdMatch {
  return {
    kind: "run",
    id: run.id,
    label: truncateLabel(`${run.agentName}: ${run.task.trim() || "（内容未記録）"}`),
    href: `/chat?runId=${encodeURIComponent(run.id)}`,
  };
}

/** プレフィックス（またはフル ID）に一致する Issue / Journal / Run をすべて返す。 */
export function resolveIdPrefix(prefix: string): IdMatch[] {
  if (!isHexIdPrefix(prefix)) return [];

  const issues = findByIdPrefix(listIssues(), (i) => i.id, prefix).map(issueMatch);
  const journals = findByIdPrefix(listJournalEntries(), (e) => e.id, prefix).map(journalMatch);
  const runs = findByIdPrefix(listRuns(), (r) => r.id, prefix).map(runMatch);

  // 完全一致を先頭に（短いプレフィックスでもフル ID 入力時は分かりやすく）
  const key = normalizeIdKey(prefix);
  const all = [...issues, ...journals, ...runs];
  all.sort((a, b) => {
    const aExact = normalizeIdKey(a.id) === key ? 0 : 1;
    const bExact = normalizeIdKey(b.id) === key ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    if (a.kind !== b.kind) {
      const order = { issue: 0, journal: 1, run: 2 } as const;
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

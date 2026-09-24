import { randomUUID } from "node:crypto";
import { unmaskNames } from "../people-directory";
import { findReferenceUrls } from "../reference-lookup";
import type { EmGrowthRepository } from "./em-growth-repository";
import type {
  GrowSuggestion,
  GrowSuggestionDraft,
  GrowSuggestionStatus,
} from "./em-growth-types";

// Grow（EM自身の学びの提示）専用。組織向けのSuggestionとは性質が異なり、生成時点で確定として扱う。
// EM側の反応は軽量な既読管理のみ（unread / acknowledged / dismissed）。

// scheduled-tasks.tsのisoWeekKeyと同じロジック（循環import回避のため複製）。
function isoWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function createEmGrowthService(repo: EmGrowthRepository) {
  const growSuggestions: GrowSuggestion[] = [...repo.load()];

  function persist(): void {
    repo.save(growSuggestions);
  }

  function listGrowSuggestions(): GrowSuggestion[] {
    return [...growSuggestions].sort((a, b) => b.generatedAt - a.generatedAt);
  }

  function getGrowSuggestion(id: string): GrowSuggestion | undefined {
    return growSuggestions.find((s) => s.id === id);
  }

  /**
   * Growバッチ1回の生成結果をまとめて保存する。呼び出し元が渡す draft のテキストは
   * 既に PERSON_n ID 化された状態である前提のため、ここでは追加の maskForStorage は行わない。
   */
  function createGrowSuggestions(
    drafts: GrowSuggestionDraft[],
    opts: { sourceRunId?: string; now?: number } = {},
  ): GrowSuggestion[] {
    const now = opts.now ?? Date.now();
    const weekKey = isoWeekKey(new Date(now));
    const created: GrowSuggestion[] = drafts.map((draft) => ({
      ...draft,
      id: randomUUID(),
      weekKey,
      status: "unread",
      sourceRunId: opts.sourceRunId,
      generatedAt: now,
    }));
    growSuggestions.push(...created);
    persist();
    return created;
  }

  /**
   * url未設定の参照を WebSearch 専用サブエージェントで後追い補完する。
   */
  async function enrichGrowSuggestionReferences(suggestions: GrowSuggestion[]): Promise<void> {
    let anyChanged = false;
    for (const target of suggestions) {
      const current = growSuggestions.find((s) => s.id === target.id);
      if (!current || current.references.length === 0) continue;

      const pending = current.references.filter((r) => !r.url);
      if (pending.length === 0) continue;

      const results = await findReferenceUrls(
        pending.map((r) => ({ topic: r.topic, isPrimarySource: r.isPrimarySource, note: r.note })),
      );
      const urlByTopic = new Map(results.filter((r) => r.url).map((r) => [r.topic, r.url as string]));
      if (urlByTopic.size === 0) continue;

      current.references = current.references.map((r) => {
        const foundUrl = r.url ?? urlByTopic.get(r.topic);
        return foundUrl ? { ...r, url: foundUrl } : r;
      });
      anyChanged = true;
    }
    if (anyChanged) persist();
  }

  function setGrowSuggestionStatus(id: string, status: GrowSuggestionStatus): GrowSuggestion | undefined {
    const s = growSuggestions.find((x) => x.id === id);
    if (!s) return undefined;
    s.status = status;
    persist();
    return s;
  }

  function toGrowSuggestionView(s: GrowSuggestion): GrowSuggestion {
    return {
      ...s,
      title: unmaskNames(s.title),
      rationale: unmaskNames(s.rationale),
      evidenceSummary: s.evidenceSummary ? unmaskNames(s.evidenceSummary) : undefined,
      references: s.references.map((r) => ({
        ...r,
        topic: unmaskNames(r.topic),
        note: r.note ? unmaskNames(r.note) : undefined,
      })),
    };
  }

  return {
    listGrowSuggestions,
    getGrowSuggestion,
    createGrowSuggestions,
    enrichGrowSuggestionReferences,
    setGrowSuggestionStatus,
    toGrowSuggestionView,
  };
}

export type EmGrowthService = ReturnType<typeof createEmGrowthService>;

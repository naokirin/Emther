import type { SettingsRulesRepository } from "./settings-repository";
import {
  DEFAULT_RULES,
  type LegacyRulesFile,
  type RulesAndConstraints,
} from "./settings-types";

/** 0〜23 の時刻配列を重複除去・昇順・最低1件に正規化する。 */
export function normalizeHourList(value: unknown, fallback: number[] = [7]): number[] {
  const from = (arr: unknown): number[] => {
    if (!Array.isArray(arr)) return [];
    return [
      ...new Set(
        arr
          .filter((h): h is number => typeof h === "number" && Number.isFinite(h))
          .map((h) => Math.min(23, Math.max(0, Math.round(h)))),
      ),
    ].sort((a, b) => a - b);
  };
  const hours = from(value);
  if (hours.length > 0) return hours;
  const fb = from(fallback);
  return fb.length > 0 ? fb : [7];
}

/** 0〜6 の曜日配列を重複除去・昇順・最低1件に正規化する。 */
export function normalizeWeekdayList(value: unknown, fallback: number[] = [1]): number[] {
  const from = (arr: unknown): number[] => {
    if (!Array.isArray(arr)) return [];
    return [
      ...new Set(
        arr
          .filter((d): d is number => typeof d === "number" && Number.isFinite(d))
          .map((d) => Math.min(6, Math.max(0, Math.round(d)))),
      ),
    ].sort((a, b) => a - b);
  };
  const days = from(value);
  if (days.length > 0) return days;
  const fb = from(fallback);
  return fb.length > 0 ? fb : [1];
}

function hydrateRules(raw: LegacyRulesFile): RulesAndConstraints {
  const {
    autoJournalBatchHour: legacyHour,
    autoDistillationWeekday: legacyWeekday,
    autoIssueUpdateAnalysisEnabled: legacyAutoIssueUpdateEnabled,
    ...rest
  } = raw;
  const merged: RulesAndConstraints = { ...DEFAULT_RULES, ...(rest as Partial<RulesAndConstraints>) };
  if (raw.autoSuggestionUpdateAnalysisEnabled === undefined && legacyAutoIssueUpdateEnabled !== undefined) {
    merged.autoSuggestionUpdateAnalysisEnabled = legacyAutoIssueUpdateEnabled;
  }
  if (Array.isArray(raw.autoJournalBatchHours) && raw.autoJournalBatchHours.length > 0) {
    merged.autoJournalBatchHours = normalizeHourList(raw.autoJournalBatchHours);
  } else if (typeof legacyHour === "number" && Number.isFinite(legacyHour)) {
    merged.autoJournalBatchHours = normalizeHourList([legacyHour]);
  } else {
    merged.autoJournalBatchHours = [...DEFAULT_RULES.autoJournalBatchHours];
  }
  if (Array.isArray(raw.autoDistillationWeekdays) && raw.autoDistillationWeekdays.length > 0) {
    merged.autoDistillationWeekdays = normalizeWeekdayList(raw.autoDistillationWeekdays);
  } else if (typeof legacyWeekday === "number" && Number.isFinite(legacyWeekday)) {
    merged.autoDistillationWeekdays = normalizeWeekdayList([legacyWeekday]);
  } else {
    merged.autoDistillationWeekdays = [...DEFAULT_RULES.autoDistillationWeekdays];
  }
  merged.autoDistillationHour = Math.min(
    23,
    Math.max(0, Math.round(merged.autoDistillationHour ?? DEFAULT_RULES.autoDistillationHour)),
  );
  return merged;
}

export function createSettingsService(repo: SettingsRulesRepository) {
  let rules: RulesAndConstraints = hydrateRules(repo.load());

  function persistRules(): void {
    repo.save(rules);
  }

  function getRulesAndConstraints(): RulesAndConstraints {
    return rules;
  }

  function updateRulesAndConstraints(patch: Partial<RulesAndConstraints>): RulesAndConstraints {
    const next: RulesAndConstraints = { ...rules, ...patch };
    if (patch.autoJournalBatchHours !== undefined) {
      next.autoJournalBatchHours = normalizeHourList(patch.autoJournalBatchHours, rules.autoJournalBatchHours);
    }
    if (patch.autoDistillationWeekdays !== undefined) {
      next.autoDistillationWeekdays = normalizeWeekdayList(
        patch.autoDistillationWeekdays,
        rules.autoDistillationWeekdays,
      );
    }
    if (patch.autoDistillationHour !== undefined) {
      next.autoDistillationHour = Math.min(23, Math.max(0, Math.round(patch.autoDistillationHour)));
    }
    rules = next;
    persistRules();
    return rules;
  }

  function getSelfPersonId(): string | null {
    return rules.selfPersonId ?? null;
  }

  function setSelfPersonId(personId: string | null): RulesAndConstraints {
    return updateRulesAndConstraints({ selfPersonId: personId });
  }

  function reassignSelfPersonId(opts: { fromId?: string; toId?: string; deletedId?: string }): void {
    const current = getSelfPersonId();
    if (!current) return;
    if (opts.deletedId && current === opts.deletedId) {
      setSelfPersonId(null);
      return;
    }
    if (opts.fromId && opts.toId && current === opts.fromId) {
      setSelfPersonId(opts.toId);
    }
  }

  return {
    getRulesAndConstraints,
    updateRulesAndConstraints,
    getSelfPersonId,
    setSelfPersonId,
    reassignSelfPersonId,
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;

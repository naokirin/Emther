import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "../styles/page.module.css";
import { Select } from "./Select";
import {
  CONFIRM_PRIORITIES,
  CONFIRM_PRIORITY_META,
  SUGGESTION_REVIEW_STATUS_META,
  SUGGESTION_REVIEW_STATUSES,
  type ConfirmPriority,
  type SuggestionReviewStatus,
} from "@emther/core/types";
import { SUGGESTION_SORT_OPTIONS, type SuggestionFilterState, type SuggestionSortKey } from "./suggestionFilter";

export type { SuggestionFilterState, SuggestionSortKey } from "./suggestionFilter";

type Props = {
  value: SuggestionFilterState;
  onChange: <K extends keyof SuggestionFilterState>(key: K, next: SuggestionFilterState[K]) => void;
  onClearFilters: () => void;
  doneCount: number;
  archivedCount: number;
  /** 適用中チップ行の右端（エクスポートなど）。 */
  trailing?: ReactNode;
};

type Chip = { key: string; label: string; clear: () => void };

/**
 * docs/design/suggestion/suggestion-tab.pen 改善案C（A/B共通）のツールバー。
 * 検索・並び替え・絞り込みポップオーバー＋適用中チップ。
 */
export function SuggestionFilterBar({
  value,
  onChange,
  onClearFilters,
  doneCount,
  archivedCount,
  trailing,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState(() => new Set(value.statusFilter));
  const [draftPriority, setDraftPriority] = useState(() => new Set(value.priorityFilter));
  const [draftShowDone, setDraftShowDone] = useState(value.showDone);
  const [draftShowArchived, setDraftShowArchived] = useState(value.showArchived);
  const rootRef = useRef<HTMLDivElement>(null);

  function syncDraftFromValue() {
    setDraftStatus(new Set(value.statusFilter));
    setDraftPriority(new Set(value.priorityFilter));
    setDraftShowDone(value.showDone);
    setDraftShowArchived(value.showArchived);
  }

  function toggleOpen() {
    if (!open) syncDraftFromValue();
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(`.${styles.customSelectList}`)) return;
      setOpen(false);
    }
    function onKeyDownCapture(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (document.querySelector(`.${styles.customSelectList}`)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDownCapture, true);
    };
  }, [open]);

  const chips = buildActiveChips(value, onChange, {
    setDraftStatus,
    setDraftPriority,
    setDraftShowDone,
    setDraftShowArchived,
  });
  const draftFilterCount =
    (draftStatus.size > 0 ? 1 : 0) +
    (draftPriority.size > 0 ? 1 : 0) +
    (!draftShowDone ? 1 : 0) +
    (draftShowArchived ? 1 : 0);
  const appliedFilterCount = chips.length;

  function toggleDraftStatus(status: SuggestionReviewStatus) {
    setDraftStatus((prev) => toggleInSet(prev, status));
  }

  function toggleDraftPriority(priority: ConfirmPriority) {
    setDraftPriority((prev) => toggleInSet(prev, priority));
  }

  function applyDraft() {
    onChange("statusFilter", draftStatus);
    onChange("priorityFilter", draftPriority);
    onChange("showDone", draftShowDone);
    onChange("showArchived", draftShowArchived);
    setOpen(false);
  }

  function clearAll() {
    onClearFilters();
    setOpen(false);
  }

  return (
    <div className={styles.suggestionFilterBar} ref={rootRef}>
      <div className={styles.suggestionToolbar}>
        <input
          type="search"
          className={styles.journalSearchInput}
          value={value.query}
          onChange={(e) => onChange("query", e.target.value)}
          placeholder="このテーマ内を検索…"
          aria-label="このテーマ内を検索"
        />
        <div className={styles.suggestionSortField}>
          <span className={styles.suggestionSortPrefix} aria-hidden="true">
            並び:
          </span>
          <Select
            value={value.sort}
            onChange={(v) => onChange("sort", v as SuggestionSortKey)}
            options={SUGGESTION_SORT_OPTIONS}
            label="並び替え"
            style={{ minWidth: 140 }}
          />
        </div>
        <button
          type="button"
          className={`${styles.journalFilterTrigger} ${open ? styles.journalFloatingTriggerOpen : ""}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={toggleOpen}
        >
          絞り込み
          {appliedFilterCount > 0 && (
            <span className={styles.journalFilterBadge} aria-hidden="true">
              {appliedFilterCount}
            </span>
          )}
        </button>
        {open && (
          <div className={styles.journalFilterPopover} role="dialog" aria-label="絞り込み">
            <div className={styles.journalFilterPopoverHead}>
              <strong>絞り込み</strong>
              <button
                type="button"
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                aria-label="閉じる"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>
            <fieldset className={styles.suggestionFilterGroup}>
              <legend>確認状態</legend>
              {SUGGESTION_REVIEW_STATUSES.map((status) => (
                <label key={status} className={styles.journalFilterCheck}>
                  <input
                    type="checkbox"
                    checked={draftStatus.has(status)}
                    onChange={() => toggleDraftStatus(status)}
                  />
                  {SUGGESTION_REVIEW_STATUS_META[status].icon} {SUGGESTION_REVIEW_STATUS_META[status].label}
                </label>
              ))}
            </fieldset>
            <fieldset className={styles.suggestionFilterGroup}>
              <legend>確認優先度</legend>
              {CONFIRM_PRIORITIES.map((p) => (
                <label key={p} className={styles.journalFilterCheck}>
                  <input
                    type="checkbox"
                    checked={draftPriority.has(p)}
                    onChange={() => toggleDraftPriority(p)}
                  />
                  {CONFIRM_PRIORITY_META[p].icon} {CONFIRM_PRIORITY_META[p].label}
                </label>
              ))}
            </fieldset>
            <label className={styles.journalFilterCheck}>
              <input
                type="checkbox"
                checked={draftShowDone}
                onChange={(e) => setDraftShowDone(e.target.checked)}
              />
              確認済み（もう追わない）も表示する（{doneCount}件）
            </label>
            <label className={styles.journalFilterCheck}>
              <input
                type="checkbox"
                checked={draftShowArchived}
                onChange={(e) => setDraftShowArchived(e.target.checked)}
              />
              🗄 アーカイブ済みも表示する（{archivedCount}件）
            </label>
            <div className={styles.journalFilterPopoverFoot}>
              <button type="button" className={styles.btnOutline} onClick={clearAll}>
                すべてクリア
              </button>
              <button type="button" className={styles.primaryBtn} style={{ width: "auto" }} onClick={applyDraft}>
                適用する{draftFilterCount > 0 ? `（${draftFilterCount}）` : ""}
              </button>
            </div>
          </div>
        )}
      </div>
      {(chips.length > 0 || trailing) && (
        <div className={styles.suggestionFilterMetaRow}>
          <div className={styles.journalFilterChips}>
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className={styles.journalFilterChip}
                onClick={chip.clear}
                aria-label={`${chip.label}を解除`}
              >
                {chip.label} <span aria-hidden="true">×</span>
              </button>
            ))}
            {chips.length > 0 && (
              <button type="button" className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={clearAll}>
                クリア
              </button>
            )}
          </div>
          {trailing}
        </div>
      )}
    </div>
  );
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function buildActiveChips(
  value: SuggestionFilterState,
  onChange: Props["onChange"],
  draft: {
    setDraftStatus: (next: Set<SuggestionReviewStatus>) => void;
    setDraftPriority: (next: Set<ConfirmPriority>) => void;
    setDraftShowDone: (next: boolean) => void;
    setDraftShowArchived: (next: boolean) => void;
  },
): Chip[] {
  const chips: Chip[] = [];
  if (value.statusFilter.size > 0) {
    const labels = SUGGESTION_REVIEW_STATUSES.filter((s) => value.statusFilter.has(s)).map(
      (s) => SUGGESTION_REVIEW_STATUS_META[s].label,
    );
    chips.push({
      key: "status",
      label: `確認状態: ${labels.join("・")}`,
      clear: () => {
        onChange("statusFilter", new Set());
        draft.setDraftStatus(new Set());
      },
    });
  }
  if (value.priorityFilter.size > 0) {
    const labels = CONFIRM_PRIORITIES.filter((p) => value.priorityFilter.has(p)).map(
      (p) => CONFIRM_PRIORITY_META[p].label,
    );
    chips.push({
      key: "priority",
      label: `確認優先度: ${labels.join("・")}`,
      clear: () => {
        onChange("priorityFilter", new Set());
        draft.setDraftPriority(new Set());
      },
    });
  }
  if (!value.showDone) {
    chips.push({
      key: "hideDone",
      label: "確認済みを隠す",
      clear: () => {
        onChange("showDone", true);
        draft.setDraftShowDone(true);
      },
    });
  }
  if (value.showArchived) {
    chips.push({
      key: "archived",
      label: "アーカイブ含む",
      clear: () => {
        onChange("showArchived", false);
        draft.setDraftShowArchived(false);
      },
    });
  }
  return chips;
}

import { useEffect, useRef, useState } from "react";
import styles from "../styles/page.module.css";
import { Select } from "./Select";
import type { JournalEntry } from "@emther/core/types";

export type JournalFilterState = {
  query: string;
  periodDays: string;
  personFilter: string;
  tagFilter: string;
  urgencyFilter: JournalEntry["urgency"] | "";
  sentimentFilter: JournalEntry["sentiment"] | "";
  excludeResolved: boolean;
  includeArchived: boolean;
  quarantinedOnly: boolean;
  includeSensitive: boolean;
};

type Props = {
  value: JournalFilterState;
  onChange: <K extends keyof JournalFilterState>(key: K, next: JournalFilterState[K]) => void;
  onClear: () => void;
  periodOptions: { value: string; label: string }[];
  urgencyOptions: { value: string; label: string }[];
  sentimentOptions: { value: string; label: string }[];
  people: string[];
  tags: string[];
};

type Chip = { key: keyof JournalFilterState; label: string };

/**
 * docs/design/journal/journal-tab.pen 改善案A「フィルタ」対応。
 * 5つのSelectを常時展開せず、検索＋「絞り込み」ポップオーバーにまとめ、
 * 適用中だけチップで見せる。
 */
export function JournalFilterBar({
  value,
  onChange,
  onClear,
  periodOptions,
  urgencyOptions,
  sentimentOptions,
  people,
  tags,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<JournalFilterState>(value);
  const rootRef = useRef<HTMLDivElement>(null);

  function toggleOpen() {
    if (!open) setDraft(value);
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      // Select の選択肢リストは createPortal で body 直下に出るため、
      // そこへの操作ではポップオーバーを閉じない。
      if (target instanceof Element && target.closest(`.${styles.customSelectList}`)) return;
      setOpen(false);
    }
    function onKeyDownCapture(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Select が開いている間は Escape を Select 側に任せ、絞り込み自体は閉じない。
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

  const chips = buildActiveChips(value, periodOptions, urgencyOptions, sentimentOptions);

  function setDraftField<K extends keyof JournalFilterState>(key: K, next: JournalFilterState[K]) {
    setDraft((prev) => ({ ...prev, [key]: next }));
  }

  function applyDraft() {
    (Object.keys(draft) as (keyof JournalFilterState)[]).forEach((key) => {
      if (key === "query") return;
      if (draft[key] !== value[key]) onChange(key, draft[key]);
    });
    setOpen(false);
  }

  function clearAll() {
    onClear();
    setOpen(false);
  }

  function removeChip(key: keyof JournalFilterState) {
    if (key === "periodDays") {
      onChange("periodDays", "all");
      setDraftField("periodDays", "all");
    } else if (
      key === "excludeResolved" ||
      key === "includeArchived" ||
      key === "quarantinedOnly" ||
      key === "includeSensitive"
    ) {
      onChange(key, false);
      setDraftField(key, false);
    } else if (key === "query") {
      onChange("query", "");
      setDraftField("query", "");
    } else {
      onChange(key, "" as JournalFilterState[typeof key]);
      setDraftField(key, "" as JournalFilterState[typeof key]);
    }
  }

  return (
    <div className={styles.journalFilterBar} ref={rootRef}>
      <div className={styles.journalSearchRow}>
        <input
          type="search"
          className={styles.journalSearchInput}
          value={value.query}
          onChange={(e) => onChange("query", e.target.value)}
          placeholder="本文・人物・タグで検索"
          aria-label="本文・人物・タグで検索"
        />
        <button
          type="button"
          className={`${styles.journalFilterTrigger} ${open ? styles.journalFloatingTriggerOpen : ""}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={toggleOpen}
        >
          絞り込み
          {chips.length > 0 && <span className={styles.journalFilterBadge}>{chips.length}</span>}
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
            <label className={styles.journalFilterField}>
              期間
              <Select
                value={draft.periodDays}
                onChange={(v) => setDraftField("periodDays", v)}
                options={periodOptions}
                style={{ width: "100%" }}
              />
            </label>
            <label className={styles.journalFilterField}>
              人物
              <Select
                value={draft.personFilter}
                onChange={(v) => setDraftField("personFilter", v)}
                options={[{ value: "", label: "すべて" }, ...people.map((p) => ({ value: p, label: p }))]}
                style={{ width: "100%" }}
              />
            </label>
            <label className={styles.journalFilterField}>
              タグ
              <Select
                value={draft.tagFilter}
                onChange={(v) => setDraftField("tagFilter", v)}
                options={[{ value: "", label: "すべて" }, ...tags.map((t) => ({ value: t, label: `#${t}` }))]}
                style={{ width: "100%" }}
              />
            </label>
            <label className={styles.journalFilterField}>
              Urgency
              <Select
                value={draft.urgencyFilter}
                onChange={(v) => setDraftField("urgencyFilter", v as JournalEntry["urgency"] | "")}
                options={urgencyOptions}
                style={{ width: "100%" }}
              />
            </label>
            <label className={styles.journalFilterField}>
              感情
              <Select
                value={draft.sentimentFilter}
                onChange={(v) => setDraftField("sentimentFilter", v as JournalEntry["sentiment"] | "")}
                options={sentimentOptions}
                style={{ width: "100%" }}
              />
            </label>
            <label className={styles.journalFilterCheck}>
              <input
                type="checkbox"
                checked={draft.excludeResolved}
                onChange={(e) => setDraftField("excludeResolved", e.target.checked)}
              />
              ✅ 対応済み/提案化済みを除外
            </label>
            <label className={styles.journalFilterCheck}>
              <input
                type="checkbox"
                checked={draft.includeArchived}
                onChange={(e) => setDraftField("includeArchived", e.target.checked)}
              />
              🗄 アーカイブ済みも表示する
            </label>
            <label
              className={`${styles.journalFilterCheck} ${styles.axisTooltip}`}
              data-tooltip="センシティブ指定したJournalも一覧に含めます（既定では非表示）"
            >
              <input
                type="checkbox"
                checked={draft.includeSensitive}
                onChange={(e) => setDraftField("includeSensitive", e.target.checked)}
              />
              センシティブも表示する
            </label>
            <label
              className={`${styles.journalFilterCheck} ${styles.axisTooltip}`}
              data-tooltip="実名を含んでいたため自動で隔離（アーカイブ）されたJournalだけに絞り込みます"
            >
              <input
                type="checkbox"
                checked={draft.quarantinedOnly}
                onChange={(e) => setDraftField("quarantinedOnly", e.target.checked)}
              />
              🔒 実名隔離のみ表示する
            </label>
            <div className={styles.journalFilterPopoverFoot}>
              <button type="button" className={styles.btnOutline} onClick={clearAll}>
                すべてクリア
              </button>
              <button type="button" className={styles.primaryBtn} style={{ width: "auto" }} onClick={applyDraft}>
                適用する
              </button>
            </div>
          </div>
        )}
      </div>
      {chips.length > 0 && (
        <div className={styles.journalFilterChips}>
          {chips.map((chip) => (
            <button
              key={String(chip.key) + chip.label}
              type="button"
              className={styles.journalFilterChip}
              onClick={() => removeChip(chip.key)}
              aria-label={`${chip.label}を解除`}
            >
              {chip.label} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={clearAll}>
            クリア
          </button>
        </div>
      )}
    </div>
  );
}

function buildActiveChips(
  value: JournalFilterState,
  periodOptions: { value: string; label: string }[],
  urgencyOptions: { value: string; label: string }[],
  sentimentOptions: { value: string; label: string }[],
): Chip[] {
  const chips: Chip[] = [];
  if (value.periodDays !== "all") {
    chips.push({
      key: "periodDays",
      label: periodOptions.find((o) => o.value === value.periodDays)?.label ?? value.periodDays,
    });
  }
  if (value.personFilter) chips.push({ key: "personFilter", label: value.personFilter });
  if (value.tagFilter) chips.push({ key: "tagFilter", label: `#${value.tagFilter}` });
  if (value.urgencyFilter) {
    chips.push({
      key: "urgencyFilter",
      label: urgencyOptions.find((o) => o.value === value.urgencyFilter)?.label ?? value.urgencyFilter,
    });
  }
  if (value.sentimentFilter) {
    chips.push({
      key: "sentimentFilter",
      label: sentimentOptions.find((o) => o.value === value.sentimentFilter)?.label ?? value.sentimentFilter,
    });
  }
  if (value.excludeResolved) chips.push({ key: "excludeResolved", label: "対応済み除外" });
  if (value.includeArchived) chips.push({ key: "includeArchived", label: "アーカイブ含む" });
  if (value.includeSensitive) chips.push({ key: "includeSensitive", label: "センシティブ含む" });
  if (value.quarantinedOnly) chips.push({ key: "quarantinedOnly", label: "実名隔離のみ" });
  return chips;
}

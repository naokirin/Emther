import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@/router";
import styles from "../styles/page.module.css";
import type { OrgTheme } from "@emther/core/types";

export const SUGGESTION_THEME_ALL = "__all__";
export const SUGGESTION_THEME_UNLINKED = "__unlinked__";

export type SuggestionThemeMenuOption = {
  value: string;
  title: string;
  summary?: string;
  count: number;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  themes: OrgTheme[];
  /** テーマごとの件数（すべて / 各テーマ / 未接続）。 */
  counts: Record<string, number>;
  /** 選択中スコープの件数サマリ文言（例: 未確認 2 · 確認中 1 · 期日超過 1）。 */
  statusSummary: string;
};

/**
 * 長文テーマ名を閉じた状態でも複数行で全文表示し、開いた項目にも要約と件数を添える
 */
export function SuggestionThemeSwitcher({ value, onChange, themes, counts, statusSummary }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const options: SuggestionThemeMenuOption[] = [
    {
      value: SUGGESTION_THEME_ALL,
      title: "すべて",
      summary: "テーマ絞りなし",
      count: counts[SUGGESTION_THEME_ALL] ?? 0,
    },
    ...themes.map((t) => ({
      value: t.id,
      title: t.title,
      summary: t.summary || undefined,
      count: counts[t.id] ?? 0,
    })),
    {
      value: SUGGESTION_THEME_UNLINKED,
      title: "未接続",
      summary: "テーマ未設定の提案",
      count: counts[SUGGESTION_THEME_UNLINKED] ?? 0,
    },
  ];

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : options[0];
  const selectedTheme = themes.find((t) => t.id === value);

  function measure() {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < 320 && r.top > spaceBelow;
    setRect({ top: openUp ? r.top : r.bottom, left: r.left, width: r.width, openUp });
  }

  useEffect(() => {
    if (!open) return;
    measure();
    function onScrollOrResize() {
      measure();
    }
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
      setActiveIndex(-1);
    }
    function onKeyDownCapture(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
      buttonRef.current?.focus();
    }
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDownCapture, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  function openList() {
    setOpen(true);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }

  function closeList() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function selectOption(index: number) {
    const opt = options[index];
    if (!opt) return;
    onChange(opt.value);
    closeList();
    buttonRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (activeIndex >= 0) selectOption(activeIndex);
        break;
      case "Tab":
        closeList();
        break;
    }
  }

  return (
    <div className={styles.suggestionThemeContext} ref={rootRef}>
      <p className={styles.suggestionThemeLabel}>いま向き合うテーマ</p>
      <button
        type="button"
        ref={buttonRef}
        className={styles.suggestionThemeSelect}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        aria-label="いま向き合うテーマ"
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.suggestionThemeSelectTitle}>{selected?.title ?? "すべて"}</span>
        <span className={styles.suggestionThemeChevron} aria-hidden="true">
          ▾
        </span>
      </button>
      {open &&
        rect &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            id={listboxId}
            aria-label="いま向き合うテーマ"
            className={styles.suggestionThemeMenu}
            style={{
              position: "fixed",
              left: rect.left,
              width: rect.width,
              ...(rect.openUp
                ? { bottom: window.innerHeight - rect.top + 4, top: "auto" }
                : { top: rect.top + 4, bottom: "auto" }),
            }}
          >
            {options.map((opt, index) => {
              const selectedOpt = opt.value === value;
              const active = index === activeIndex;
              return (
                <li
                  key={opt.value}
                  id={`${listboxId}-opt-${index}`}
                  role="option"
                  aria-selected={selectedOpt}
                  data-index={index}
                  className={`${styles.suggestionThemeMenuItem} ${active ? styles.suggestionThemeMenuItemActive : ""} ${selectedOpt ? styles.suggestionThemeMenuItemSelected : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(index);
                  }}
                >
                  <div className={styles.suggestionThemeMenuItemMain}>
                    <span className={styles.suggestionThemeMenuItemTitle}>{opt.title}</span>
                    {opt.summary && <span className={styles.suggestionThemeMenuItemSummary}>{opt.summary}</span>}
                  </div>
                  <span className={styles.suggestionThemeMenuItemCount}>{opt.count}</span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
      <div className={styles.suggestionThemeMeta}>
        <span className={styles.suggestionThemeCounts}>{statusSummary}</span>
        {selectedTheme ? (
          <Link to={`/?theme=${encodeURIComponent(selectedTheme.id)}`} className={styles.suggestionThemeDetailLink}>
            テーマ詳細 →
          </Link>
        ) : (
          <span className={styles.suggestionThemeDetailLinkMuted}>テーマ詳細 →</span>
        )}
      </div>
      {selectedTheme?.summary && <p className={styles.suggestionThemeSummary}>{selectedTheme.summary}</p>}
    </div>
  );
}

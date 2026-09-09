"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "@/app/page.module.css";

export type MultiSelectOption = { value: string; label: string };

// ユーザー指摘「チームが増えるとメンバー詳細にチーム名の選択肢が大量に並ぶ」対応。
// Select.tsx（WAI-ARIA「Select-Only Combobox」パターン、ポータル配置のリストボックス）と
// 同じ土台（外側クリック・Escape（Modal内でも先取りできるようcaptureフェーズ）・
// スクロール/リサイズ追従）を流用しつつ、こちらは「テキスト入力で部分一致絞り込み→
// 選んだものをタグとして表示・✕で解除」というマルチセレクト向けの入力に置き換える。
// 未選択の選択肢は入力するまで一覧に出さない（全件を常に並べない）。
export function MultiSelectAutocomplete({
  values,
  onChange,
  options,
  placeholder = "入力して検索",
  label,
  disabled,
  style,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: MultiSelectOption[];
  placeholder?: string;
  // 呼び出し側が既に<label>等で名前付けしている場合は渡さない（Select.tsxと同じ規約）。
  label?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const selectedSet = new Set(values);
  const trimmedQuery = query.trim().toLowerCase();
  // 未選択のものだけを候補にする（選択済みはタグ側に表示済みのため）。クエリが空の間は
  // 「入力するまで大量の選択肢を並べない」ため候補を出さない。
  const filtered = trimmedQuery
    ? options.filter((o) => !selectedSet.has(o.value) && o.label.toLowerCase().includes(trimmedQuery))
    : [];

  function measure() {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < 260 && r.top > spaceBelow;
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
    // Select.tsxと同じ理由（Modal.tsxのEscapeハンドラより先取りする必要がある）。
    function onKeyDownCapture(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
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

  function selectOption(index: number) {
    const opt = filtered[index];
    if (!opt) return;
    onChange([...values, opt.value]);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function removeValue(value: string) {
    onChange(values.filter((v) => v !== value));
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    // 入力欄が空の状態でBackspaceを押すと、直近に選んだタグを解除する
    // （GitHubのラベル選択・Notionのマルチセレクト等と同じ慣習的な操作）。
    if (e.key === "Backspace" && query === "" && values.length > 0) {
      removeValue(values[values.length - 1]);
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown" && filtered.length > 0) {
        e.preventDefault();
        setOpen(true);
        setActiveIndex(0);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0) selectOption(activeIndex);
        break;
      case "Escape":
        // documentのcaptureリスナー（Modal互換のため）が既に処理するので、ここでは
        // ネイティブのフォーム送信等を止めるだけに留める。
        e.preventDefault();
        break;
    }
  }

  const selectedOptions = values.map((v) => options.find((o) => o.value === v)).filter((o): o is MultiSelectOption => !!o);

  return (
    <div className={styles.multiSelectField} style={style} ref={rootRef}>
      <div className={`${styles.multiSelectInputWrap} ${disabled ? styles.multiSelectInputWrapDisabled : ""}`}>
        {selectedOptions.map((opt) => (
          <span key={opt.value} className={styles.multiSelectTag}>
            {opt.label}
            <button
              type="button"
              className={styles.multiSelectTagRemove}
              onClick={() => removeValue(opt.value)}
              disabled={disabled}
              aria-label={`${opt.label}を解除`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
          aria-label={label}
          className={styles.multiSelectInput}
          value={query}
          placeholder={selectedOptions.length === 0 ? placeholder : ""}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => {
            if (trimmedQuery) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open &&
        rect &&
        filtered.length > 0 &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            id={listboxId}
            aria-label={label}
            className={styles.customSelectList}
            style={{
              position: "fixed",
              left: rect.left,
              width: rect.width,
              ...(rect.openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.top + 4 }),
            }}
          >
            {filtered.map((opt, i) => (
              <li
                key={opt.value}
                data-index={i}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={false}
                className={`${styles.customSelectOption} ${i === activeIndex ? styles.customSelectOptionActive : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectOption(i)}
              >
                {opt.label}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}

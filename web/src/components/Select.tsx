"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "@/app/page.module.css";

export type SelectOption = { value: string; label: string };

// 改修依頼「selectの選択肢の選択のしにくさそのものの改善」対応。ネイティブ<select>は
// 開いたポップアップ自体をCSSでスタイルできず（OS依存の見た目・小さい文字・当たり判定）、
// これが選びにくさの本体だった。閉じた状態の見た目だけをカスタムCSSで整えても
// （globals.cssのselect{}）解決しないため、WAI-ARIA「Select-Only Combobox」パターン
// （https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/）
// に沿った自前のリストボックスに置き換える。フォーカスはボタン自身に留め、矢印キーで
// aria-activedescendantを動かす（DOM focusを選択肢へ移さない）。
//
// ポップアップはdocument.bodyへポータルし、position:fixedでトリガーボタンの位置に
// 合わせて描く。Modal（.modalBoxがoverflow-y:autoでスクロールコンテナ）の中で使っても、
// ポップアップがモーダルの枠でクリップされないようにするため。
export function Select({
  value,
  onChange,
  options,
  placeholder = "選択してください",
  label,
  disabled,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  // 呼び出し側が<label>で囲む・.fieldCaptionを添える等、外部から既に名前付けしている場合は
  // 渡さない（aria-labelが優先され、外部ラベルを上書きしてしまうため）。
  label?: string;
  disabled?: boolean;
  // .field内（縦積み・幅いっぱい）と、インラインのフィルタ行（横並び・内容幅）の
  // 両方で使うため、幅の決め方は呼び出し側に委ねる（例: style={{ width: "100%" }}）。
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();
  const typeaheadRef = useRef<{ text: string; timer: ReturnType<typeof setTimeout> | null }>({ text: "", timer: null });

  const selectedIndex = options.findIndex((o) => o.value === value);

  function measure() {
    const el = buttonRef.current;
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
    // Modal.tsxはdocument上のbubbleフェーズでEscapeを拾って自身を閉じる。そのリスナーは
    // Modalが開いた時点（＝このSelectが開くより前）に登録済みなので、同じbubbleフェーズで
    // 後から登録してもstopPropagation()では間に合わない（登録順に発火し、Modal側が先に
    // 閉じてしまう）。captureフェーズで先取りして止める。
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

  // アクティブな選択肢を常にリスト内に見える位置までスクロールする。
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    // jsdom（テスト環境）にはscrollIntoViewが実装されていないため存在チェックする。
    el?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  function openList() {
    if (disabled || options.length === 0) return;
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
    if (disabled) return;
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
      default:
        if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
          const ref = typeaheadRef.current;
          if (ref.timer) clearTimeout(ref.timer);
          ref.text += e.key.toLowerCase();
          const text = ref.text;
          const match = options.findIndex((o) => o.label.toLowerCase().startsWith(text));
          if (match >= 0) setActiveIndex(match);
          ref.timer = setTimeout(() => {
            ref.text = "";
          }, 500);
        }
    }
  }

  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  return (
    <div className={styles.customSelect} style={style} ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.customSelectButton}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={handleKeyDown}
      >
        <span className={selected ? undefined : styles.customSelectPlaceholder}>{selected ? selected.label : placeholder}</span>
      </button>
      {open &&
        rect &&
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
            {options.map((opt, i) => (
              <li
                key={opt.value}
                data-index={i}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={opt.value === value}
                className={`${styles.customSelectOption} ${i === activeIndex ? styles.customSelectOptionActive : ""} ${
                  opt.value === value ? styles.customSelectOptionSelected : ""
                }`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectOption(i)}
              >
                <span className={styles.customSelectCheck}>{opt.value === value ? "✓" : ""}</span>
                {opt.label}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}

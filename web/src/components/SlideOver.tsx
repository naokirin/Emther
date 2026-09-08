"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 改修依頼「Notionのように詳細を右からスライドでオーバーレイ表示（サイドピーク）」対応。
// Modal.tsxと同じa11yパターン（フォーカストラップ・Escape・aria-modal・フォーカス復元）を
// 踏襲しつつ、レイアウトだけ右からのスライドインに変える。「しっかり確認したい場合」は
// detailHrefで独立ページ（/issues/[id]等、フルページ表示のまま変更していない）へ
// 遷移できるようにし、一覧⇄詳細の移動コストを状況に応じて選べるようにする。
export function SlideOver({
  title,
  onClose,
  detailHref,
  children,
}: {
  title: string;
  onClose: () => void;
  // 「詳細画面で開く」導線の遷移先。省略時はリンクを出さない。
  detailHref?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !boxRef.current) return;
      const focusable = boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.slideOverOverlay} onClick={onClose}>
      <div
        ref={boxRef}
        className={styles.slideOverBox}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.slideOverHeader}>
          <h2 id={titleId} style={{ margin: 0 }}>
            {title}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {detailHref && (
              <Link href={detailHref} className={styles.detailToggle}>
                詳細画面で開く
              </Link>
            )}
            <button className={styles.modalClose} onClick={onClose} aria-label="閉じる">
              ×
            </button>
          </div>
        </div>
        <div className={styles.slideOverBody}>{children}</div>
      </div>
    </div>
  );
}

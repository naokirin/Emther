import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import styles from "../styles/page.module.css";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 画面遷移を伴わない入力のためのシンプルなダイアログ。
// size="wide" は Why/What/How など本文欄のある起票フォーム向け（既定の440pxだとPCでも狭い）。
// WCAG 2.2対応: role="dialog"+aria-modal+aria-labelledbyでスクリーンリーダーに
// 役割と名前を伝え、開いた瞬間にダイアログ内へフォーカスを移し、閉じたら元々
// フォーカスのあった要素（開くボタン等）へ戻す。Tab/Shift+Tabはダイアログ内だけを
// 巡回させる（背後のページへフォーカスが漏れる「フォーカストラップの欠如」を防ぐ）。
//
// createPortalでdocument.body直下に描画する:
// MarkdownView等の文章内リンクからモーダルが開かれた場合でも、<p>要素の中に
// <div>や<h2>が入り込むHTML文法違反（In HTML, <h2> cannot be a descendant of <p>）
// やハイドレーションエラーを確実に防ぐ。
export function Modal({
  title,
  onClose,
  children,
  size = "default",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "default" | "wide";
}) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [mounted]);

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

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        ref={boxRef}
        className={size === "wide" ? `${styles.modalBox} ${styles.modalBoxWide}` : styles.modalBox}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id={titleId} style={{ margin: 0 }}>
            {title}
          </h2>
          <button className={styles.modalClose} onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

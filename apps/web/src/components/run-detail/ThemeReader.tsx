import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { IdLinkedText } from "../IdLinkedText";
import { IdFragmentLink } from "../IdFragmentLink";
import type { SuggestedTheme } from "@emther/core/agent-runtime";
import styles from "../../styles/page.module.css";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ThemeReader({
  themes,
  initialIndex = 0,
  onClose,
}: {
  themes: SuggestedTheme[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const titleId = useId();
  const shellRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const showToc = themes.length > 1;
  const safeIndex = Math.min(Math.max(0, initialIndex), Math.max(0, themes.length - 1));

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    shellRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !shellRef.current) return;
      const focusable = shellRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
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

  useEffect(() => {
    document.getElementById(`theme-section-${safeIndex}`)?.scrollIntoView({ block: "start" });
  }, [safeIndex]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.adviceReaderOverlay} onClick={onClose}>
      <div
        ref={shellRef}
        className={styles.adviceReaderShell}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.adviceReaderHeader}>
          <h2 id={titleId}>🧭 テーマ解釈（状況蒸留）</h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        <div className={styles.adviceReaderLayout} style={showToc ? undefined : { gridTemplateColumns: "1fr" }}>
          {showToc && (
            <nav className={styles.adviceReaderToc} aria-label="目次">
              <span className={styles.adviceReaderTocLabel}>目次</span>
              <ol className={styles.adviceReaderTocList}>
                {themes.map((theme, i) => (
                  <li key={i}>
                    <a
                      href={`#theme-section-${i}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(`theme-section-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      {theme.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <div className={styles.adviceReaderBody}>
            {themes.map((theme, i) => (
              <section key={i} id={`theme-section-${i}`} className={styles.adviceReaderSection}>
                <h3 className={styles.adviceReaderSectionTitle}>
                  <IdLinkedText text={theme.title} />
                </h3>
                <p className={styles.adviceReaderSectionSummary}>
                  <IdLinkedText text={theme.summary} />
                </p>
                <div className={styles.adviceReaderField}>
                  <span className={styles.adviceReaderFieldLabel}>なぜこの結果に至ったか</span>
                  <p style={{ margin: "6px 0 0", lineHeight: 1.55 }}>
                    <IdLinkedText text={theme.rationale} />
                  </p>
                </div>
                {theme.facts.length > 0 && (
                  <div className={styles.adviceReaderField}>
                    <span className={styles.adviceReaderFieldLabel}>根拠ファクト</span>
                    <ul>
                      {theme.facts.map((f, fi) => (
                        <li key={fi}>
                          <IdLinkedText text={f} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {theme.rootCause && (
                  <div className={styles.adviceReaderField}>
                    <span className={styles.adviceReaderFieldLabel}>根本原因</span>
                    <p style={{ margin: "6px 0 0", lineHeight: 1.55 }}>
                      <IdLinkedText text={theme.rootCause} />
                    </p>
                  </div>
                )}
                {theme.suggestedDirection && (
                  <div className={styles.adviceReaderField}>
                    <span className={styles.adviceReaderFieldLabel}>解決の方向性</span>
                    <p style={{ margin: "6px 0 0", lineHeight: 1.55 }}>
                      <IdLinkedText text={theme.suggestedDirection} />
                    </p>
                  </div>
                )}
                {(theme.evidenceSuggestionIds?.length || theme.evidenceJournalIds?.length) ? (
                  <div className={styles.adviceReaderField}>
                    <span className={styles.adviceReaderFieldLabel}>根拠リンク</span>
                    {theme.evidenceSuggestionIds && theme.evidenceSuggestionIds.length > 0 && (
                      <p style={{ margin: "6px 0 0" }}>
                        提案:{" "}
                        {theme.evidenceSuggestionIds.map((id, ii) => (
                          <span key={id}>
                            {ii > 0 ? "、" : ""}
                            <IdFragmentLink fragment={id} className={styles.idFragmentLink}>
                              {id.slice(0, 8)}
                            </IdFragmentLink>
                          </span>
                        ))}
                      </p>
                    )}
                    {theme.evidenceJournalIds && theme.evidenceJournalIds.length > 0 && (
                      <p style={{ margin: "6px 0 0" }}>
                        Journal:{" "}
                        {theme.evidenceJournalIds.map((id, ii) => (
                          <span key={id}>
                            {ii > 0 ? "、" : ""}
                            <IdFragmentLink fragment={id} className={styles.idFragmentLink}>
                              {id.slice(0, 8)}
                            </IdFragmentLink>
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

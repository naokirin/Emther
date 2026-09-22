import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { IdLinkedText } from "./IdLinkedText";
import {
  adviceGroupOutlineLabel,
  mergeAdviceFollowUps,
  type AdviceFollowUp,
  type AdviceStructured,
} from "@emther/core/advice";
import styles from "../styles/page.module.css";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function SectionField({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.adviceReaderField}>
      <span className={styles.adviceReaderFieldLabel}>{label}</span>
      <ul>
        {items.map((item, i) => (
          <li key={i}>
            <IdLinkedText text={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FollowUpChips({
  followUps,
  onFollowUp,
  disabled,
}: {
  followUps: AdviceFollowUp[];
  onFollowUp: (f: AdviceFollowUp) => void;
  disabled?: boolean;
}) {
  if (followUps.length === 0) return null;
  return (
    <div className={styles.adviceReaderFollowUps}>
      <span className={styles.adviceReaderFieldLabel}>深掘りする</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {followUps.map((f) => (
          <button
            key={f.label}
            type="button"
            disabled={disabled}
            onClick={() => onFollowUp(f)}
            style={{
              fontSize: "0.85rem",
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--gray-bg)",
              color: "var(--foreground)",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              textAlign: "left",
              maxWidth: "100%",
              fontWeight: 500,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 進め方アドバイスの全文リーダー（ほぼ全画面・目次付き）。 */
export function AdviceReader({
  structured,
  onClose,
  onFollowUp,
  followUpsDisabled,
}: {
  structured: AdviceStructured;
  onClose: () => void;
  onFollowUp?: (f: AdviceFollowUp) => void;
  followUpsDisabled?: boolean;
}) {
  const titleId = useId();
  const shellRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const showToc = structured.groups.length > 1;
  const followUps = onFollowUp ? mergeAdviceFollowUps(structured.followUps) : [];

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
          <h2 id={titleId}>💡 進め方のアドバイス</h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        <div className={styles.adviceReaderLayout} style={showToc ? undefined : { gridTemplateColumns: "1fr" }}>
          {showToc && (
            <nav className={styles.adviceReaderToc} aria-label="目次">
              <span className={styles.adviceReaderTocLabel}>目次</span>
              <ol className={styles.adviceReaderTocList}>
                {structured.overview ? (
                  <li>
                    <a
                      href="#advice-overview"
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById("advice-overview")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      要点
                    </a>
                  </li>
                ) : null}
                {structured.groups.map((g, i) => (
                  <li key={i}>
                    <a
                      href={`#advice-section-${i}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(`advice-section-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      {adviceGroupOutlineLabel(g, i)}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <div className={styles.adviceReaderBody}>
            {structured.overview && (
              <p id="advice-overview" className={styles.adviceReaderOverview}>
                <IdLinkedText text={structured.overview} />
              </p>
            )}

            {structured.groups.map((g, i) => {
              const heading = adviceGroupOutlineLabel(g, i);
              return (
                <section key={i} id={`advice-section-${i}`} className={styles.adviceReaderSection}>
                  <h3 className={styles.adviceReaderSectionTitle}>
                    <IdLinkedText text={heading} />
                  </h3>
                  {g.summary && (
                    <p className={styles.adviceReaderSectionSummary}>
                      <IdLinkedText text={g.summary} />
                    </p>
                  )}
                  <SectionField label="やること" items={g.nextActions ?? []} />
                  <SectionField label="注意点" items={g.watchOuts ?? []} />
                  <SectionField label="確認・検証" items={g.verify ?? []} />
                </section>
              );
            })}

            {onFollowUp && (
              <FollowUpChips
                followUps={followUps}
                onFollowUp={onFollowUp}
                disabled={followUpsDisabled}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

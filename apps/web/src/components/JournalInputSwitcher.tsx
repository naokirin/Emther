import { useEffect, useRef, useState } from "react";
import styles from "../styles/page.module.css";
import { LocalLogSummaryImporter } from "./LocalLogSummaryImporter";
import { ObservationDumpSection } from "./ObservationDumpSection";
import { QuickJournalNoteForm } from "./QuickJournalNoteForm";

type Mode = "single" | "local-summary" | "bulk";

type Props = {
  onSaved: () => void;
  /** `/journal?dump=` から深いリンク。あれば「まとめて取り込む」を既定で開く */
  focusDumpId?: string | null;
  /** 初期表示モード（未指定時は "single"） */
  initialMode?: Mode;
  /** 外部（今日タブ等）からのプリフィル文字列。指定時は随時メモを初期表示 */
  prefill?: string | null;
};

const IMPORT_OPTIONS: {
  mode: Exclude<Mode, "single">;
  icon: string;
  title: string;
  description: string;
}[] = [
  {
    mode: "local-summary",
    icon: "🔒",
    title: "議事録ローカル要約",
    description: "機微なログを端末内だけで要約し、シグナルだけ保存",
  },
  {
    mode: "bulk",
    icon: "📥",
    title: "まとめて取り込む",
    description: "観測ログを貼り付け、チャンクを選んでJournal化",
  },
];

/**
 * 既定は「書く」（随時メモ）だけを見せ、議事録ローカル要約・まとめて取り込みは
 * 「他の取り込み方」メニューへ退避する。タブバーは出さない
 */
export function JournalInputSwitcher({ onSaved, focusDumpId, initialMode, prefill }: Props) {
  const [mode, setMode] = useState<Mode>(
    focusDumpId ? "bulk" : prefill ? "single" : (initialMode ?? "single"),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    }
    function onKeyDownCapture(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDownCapture, true);
    };
  }, [menuOpen]);

  const activeImport = IMPORT_OPTIONS.find((o) => o.mode === mode);

  return (
    <div className={styles.panel} style={{ marginBottom: 16 }}>
      <div className={styles.journalWriteHeader}>
        {mode === "single" ? (
          <h3 className={styles.journalSectionLabel}>書く</h3>
        ) : (
          <div className={styles.journalWriteModeHead}>
            <button
              type="button"
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              onClick={() => setMode("single")}
            >
              ← 随時メモに戻る
            </button>
            {activeImport && (
              <span className={styles.journalModeBadge}>
                {activeImport.icon} {activeImport.title}
              </span>
            )}
          </div>
        )}
        <div className={styles.journalImportMenu} ref={menuRef}>
          <button
            type="button"
            className={`${styles.journalImportTrigger} ${menuOpen ? styles.journalFloatingTriggerOpen : ""}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            他の取り込み方 {menuOpen ? "▴" : "▾"}
          </button>
          {menuOpen && (
            <div className={styles.journalFloatingMenu} role="menu">
              {IMPORT_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  role="menuitem"
                  className={styles.journalImportMenuItem}
                  onClick={() => {
                    setMode(opt.mode);
                    setMenuOpen(false);
                  }}
                >
                  <span className={styles.journalImportMenuIcon} aria-hidden="true">
                    {opt.icon}
                  </span>
                  <span className={styles.journalImportMenuText}>
                    <span className={styles.journalImportMenuTitle}>{opt.title}</span>
                    <span className={styles.journalImportMenuDesc}>{opt.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {mode === "single" ? (
        <QuickJournalNoteForm onCreated={onSaved} initialText={prefill ?? undefined} />
      ) : mode === "local-summary" ? (
        <LocalLogSummaryImporter onCreated={onSaved} />
      ) : (
        <ObservationDumpSection onAccepted={onSaved} focusDumpId={focusDumpId} />
      )}
    </div>
  );
}

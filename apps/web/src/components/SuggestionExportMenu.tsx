import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "../styles/page.module.css";
import {
  SuggestionExportColumnEditor,
  type SuggestionExportColumnEditorProps,
} from "./SuggestionExportColumnEditor";

type Props = {
  selectedCount: number;
  filteredCount: number;
  columnIds: SuggestionExportColumnEditorProps["value"];
  onColumnIdsChange: SuggestionExportColumnEditorProps["onChange"];
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onCopyTsv: () => void;
  onCopyMdTable: () => void;
  onDownloadCsv: () => void;
  onDownloadMd: () => void;
  feedback?: string | null;
};

type Panel = "menu" | "columns";

/**
 * docs/design/suggestion/suggestion-tab.pen エクスポート改善。
 * 常時面はミュートな「エクスポート」のみ。形式・列設定はポップオーバー内へ段階開示。
 */
export function SuggestionExportMenu({
  selectedCount,
  filteredCount,
  columnIds,
  onColumnIdsChange,
  onSelectAllFiltered,
  onClearSelection,
  onCopyTsv,
  onCopyMdTable,
  onDownloadCsv,
  onDownloadMd,
  feedback,
}: Props) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("menu");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (panel === "columns") setPanel("menu");
      else setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, panel]);

  function toggleOpen() {
    setOpen((v) => {
      if (!v) setPanel("menu");
      return !v;
    });
  }

  const scopeLabel =
    selectedCount > 0 ? `選択 ${selectedCount}件` : `フィルタ結果 ${filteredCount}件`;
  const triggerLabel = selectedCount > 0 ? `エクスポート · ${selectedCount}` : "エクスポート";

  return (
    <div className={styles.suggestionExportMenu} ref={rootRef}>
      <button
        type="button"
        className={`${styles.suggestionExportTrigger} ${open ? styles.suggestionExportTriggerOpen : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? menuId : undefined}
        onClick={toggleOpen}
      >
        {triggerLabel} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={menuId}
          className={styles.suggestionExportPopover}
          role="dialog"
          aria-label={panel === "columns" ? "列の順・表示" : "エクスポート"}
        >
          {panel === "menu" ? (
            <ExportMenuPanel
              scopeLabel={scopeLabel}
              selectedCount={selectedCount}
              onSelectAllFiltered={onSelectAllFiltered}
              onClearSelection={onClearSelection}
              onCopyTsv={() => {
                onCopyTsv();
              }}
              onCopyMdTable={onCopyMdTable}
              onDownloadCsv={onDownloadCsv}
              onDownloadMd={onDownloadMd}
              onOpenColumns={() => setPanel("columns")}
              feedback={feedback}
            />
          ) : (
            <ExportColumnsPanel
              value={columnIds}
              onChange={onColumnIdsChange}
              onBack={() => setPanel("menu")}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ExportMenuPanel({
  scopeLabel,
  selectedCount,
  onSelectAllFiltered,
  onClearSelection,
  onCopyTsv,
  onCopyMdTable,
  onDownloadCsv,
  onDownloadMd,
  onOpenColumns,
  feedback,
}: {
  scopeLabel: string;
  selectedCount: number;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onCopyTsv: () => void;
  onCopyMdTable: () => void;
  onDownloadCsv: () => void;
  onDownloadMd: () => void;
  onOpenColumns: () => void;
  feedback?: string | null;
}) {
  return (
    <>
      <div className={styles.suggestionExportScope}>
        <div className={styles.suggestionExportScopeCap}>対象</div>
        <div className={styles.suggestionExportScopeVal}>{scopeLabel}</div>
        <div className={styles.suggestionExportScopeActs}>
          <button type="button" className={styles.suggestionExportLink} onClick={onSelectAllFiltered}>
            フィルタ全選択
          </button>
          <button
            type="button"
            className={styles.suggestionExportLinkMuted}
            disabled={selectedCount === 0}
            onClick={onClearSelection}
          >
            選択解除
          </button>
        </div>
      </div>

      <div className={styles.suggestionExportPrimary}>
        <button type="button" className={styles.primaryBtn} style={{ width: "100%" }} onClick={onCopyTsv}>
          表をコピー（TSV）
        </button>
        <p className={styles.suggestionExportHint}>Sheets / Excel への貼り付け向け</p>
      </div>

      <div className={styles.suggestionExportSecondary}>
        <MenuItem onClick={onCopyMdTable}>表をコピー（Markdown）</MenuItem>
        <MenuItem onClick={onDownloadCsv}>CSV を保存</MenuItem>
        <MenuItem onClick={onDownloadMd}>Markdown を保存</MenuItem>
      </div>

      <button type="button" className={styles.suggestionExportColsLink} onClick={onOpenColumns}>
        <span>列の順・表示</span>
        <span aria-hidden="true">›</span>
      </button>

      {feedback && <p className={styles.suggestionExportFeedback}>{feedback}</p>}
    </>
  );
}

function ExportColumnsPanel({
  value,
  onChange,
  onBack,
}: {
  value: SuggestionExportColumnEditorProps["value"];
  onChange: SuggestionExportColumnEditorProps["onChange"];
  onBack: () => void;
}) {
  return (
    <>
      <div className={styles.suggestionExportColsHead}>
        <button type="button" className={styles.suggestionExportLink} onClick={onBack}>
          ‹ エクスポート
        </button>
        <strong className={styles.suggestionExportColsTitle}>列の順・表示</strong>
        <p className={styles.suggestionExportHint}>
          Notion DB / Sheets の列順に合わせられます。この端末にだけ保存します。
        </p>
      </div>
      <SuggestionExportColumnEditor value={value} onChange={onChange} />
    </>
  );
}

function MenuItem({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={styles.suggestionExportMenuItem} onClick={onClick}>
      {children}
    </button>
  );
}

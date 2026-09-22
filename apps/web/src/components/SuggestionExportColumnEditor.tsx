import { useEffect, useState, type DragEvent } from "react";
import styles from "../styles/page.module.css";
import {
  SUGGESTION_EXPORT_COLUMNS,
  enableAllExportColumns,
  moveExportColumn,
  partitionExportColumns,
  reorderExportColumn,
  toggleExportColumn,
  type SuggestionExportColumnId,
} from "@emther/core/suggestion-export";
import { loadSuggestionExportColumnIds, saveSuggestionExportColumnIds } from "../lib/suggestionExportColumns";

export type SuggestionExportColumnEditorProps = {
  value: SuggestionExportColumnId[];
  onChange: (next: SuggestionExportColumnId[]) => void;
};

const DRAG_MIME = "application/x-emther-export-column";

/**
 * docs/suggestion_export.md Phase B β / suggestion-tab.pen「列設定」ドリルイン。
 * 列のオン／オフと有効列の並び替え（↑↓ とドラッグ）。設定は呼び出し側が localStorage に保存する。
 */
export function SuggestionExportColumnEditor({ value, onChange }: SuggestionExportColumnEditorProps) {
  const { enabled, disabled } = partitionExportColumns(value);
  const headerById = new Map(SUGGESTION_EXPORT_COLUMNS.map((c) => [c.id, c.header]));
  const allSelected = disabled.length === 0;
  const [draggingId, setDraggingId] = useState<SuggestionExportColumnId | null>(null);
  const [overId, setOverId] = useState<SuggestionExportColumnId | null>(null);

  function clearDrag() {
    setDraggingId(null);
    setOverId(null);
  }

  function handleDragStart(e: DragEvent, id: SuggestionExportColumnId) {
    e.dataTransfer.setData(DRAG_MIME, id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  }

  function handleDragOver(e: DragEvent, id: SuggestionExportColumnId) {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overId !== id) setOverId(id);
  }

  function handleDrop(e: DragEvent, targetId: SuggestionExportColumnId) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
    const fromId = (raw || draggingId) as SuggestionExportColumnId | null;
    clearDrag();
    if (!fromId || fromId === targetId) return;
    const toIndex = enabled.indexOf(targetId);
    if (toIndex < 0) return;
    onChange(reorderExportColumn(value, fromId, toIndex));
  }

  return (
    <div className={styles.suggestionExportColsBody}>
      <div className={styles.suggestionExportColsSection}>
        <div className={styles.suggestionExportColsSectionHead}>
          <span>出力する列（上から順）</span>
          <span className={styles.tableMuted}>{enabled.length}列</span>
        </div>
        <ul className={styles.suggestionExportColList}>
          {enabled.map((id, index) => {
            const label = headerById.get(id) ?? id;
            const isDragging = draggingId === id;
            const isOver = overId === id && draggingId !== id;
            return (
              <li
                key={id}
                className={`${styles.suggestionExportColRow} ${isDragging ? styles.suggestionExportColRowDragging : ""} ${isOver ? styles.suggestionExportColRowOver : ""}`}
                onDragOver={(e) => handleDragOver(e, id)}
                onDragLeave={() => {
                  if (overId === id) setOverId(null);
                }}
                onDrop={(e) => handleDrop(e, id)}
              >
                <span
                  className={styles.suggestionExportColHandle}
                  draggable
                  role="button"
                  tabIndex={0}
                  aria-label={`${label}をドラッグして並べ替え`}
                  onDragStart={(e) => handleDragStart(e, id)}
                  onDragEnd={clearDrag}
                >
                  ⋮⋮
                </span>
                <span className={styles.suggestionExportColName}>{label}</span>
                <span className={styles.suggestionExportColActs}>
                  <button
                    type="button"
                    className={styles.suggestionExportIconBtn}
                    aria-label={`${label}を上へ`}
                    disabled={index === 0}
                    onClick={() => onChange(moveExportColumn(value, id, "up"))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.suggestionExportIconBtn}
                    aria-label={`${label}を下へ`}
                    disabled={index === enabled.length - 1}
                    onClick={() => onChange(moveExportColumn(value, id, "down"))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.suggestionExportIconBtn}
                    aria-label={`${label}を外す`}
                    onClick={() => onChange(toggleExportColumn(value, id, false))}
                  >
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {disabled.length > 0 && (
        <div className={styles.suggestionExportColsSection}>
          <div className={styles.suggestionExportColsSectionHead}>
            <span>追加できる列</span>
          </div>
          <div className={styles.suggestionExportAddChips}>
            {disabled.map((id) => (
              <button
                key={id}
                type="button"
                className={styles.suggestionExportAddChip}
                onClick={() => onChange(toggleExportColumn(value, id, true))}
              >
                ＋ {headerById.get(id) ?? id}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.suggestionExportColsFooter}>
        <button
          type="button"
          className={styles.suggestionExportLink}
          disabled={allSelected}
          onClick={() => onChange(enableAllExportColumns(value))}
        >
          すべての列を追加
        </button>
      </div>
    </div>
  );
}

/** 一覧ページ用: localStorage と同期した列設定フック。 */
export function useSuggestionExportColumns() {
  const [columnIds, setColumnIds] = useState<SuggestionExportColumnId[]>(() => [
    ...loadSuggestionExportColumnIds(),
  ]);

  useEffect(() => {
    saveSuggestionExportColumnIds(columnIds);
  }, [columnIds]);

  return { columnIds, setColumnIds };
}

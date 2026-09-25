import { useState, type DragEvent, type ReactNode } from "react";
import styles from "../../styles/page.module.css";

const DRAG_MIME = "application/x-emther-sortable-id";

export type SortableListProps = {
  ids: string[];
  disabled?: boolean;
  onReorder: (orderedIds: string[]) => void | Promise<void>;
  renderItem: (id: string, dragHandle: ReactNode) => ReactNode;
};

/**
 * HTML5 DnD で ids の相対順を入れ替え、確定時に onReorder を呼ぶ。
 * SuggestionExportColumnEditor と同型のハンドル付き行。
 */
export function SortableList({ ids, disabled, onReorder, renderItem }: SortableListProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function clearDrag() {
    setDraggingId(null);
    setOverId(null);
  }

  function handleDragStart(e: DragEvent, id: string) {
    if (disabled || busy) return;
    e.dataTransfer.setData(DRAG_MIME, id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  }

  function handleDragOver(e: DragEvent, id: string) {
    if (!draggingId || draggingId === id || disabled || busy) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overId !== id) setOverId(id);
  }

  async function handleDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
    const fromId = (raw || draggingId) as string | null;
    clearDrag();
    if (!fromId || fromId === targetId || disabled || busy) return;
    const fromIndex = ids.indexOf(fromId);
    const toIndex = ids.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...ids];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, fromId);
    setBusy(true);
    try {
      await onReorder(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.sortableList} aria-busy={busy || undefined}>
      {ids.map((id) => {
        const isDragging = draggingId === id;
        const isOver = overId === id && draggingId !== id;
        const handle = (
          <span
            className={styles.sortableHandle}
            draggable={!disabled && !busy}
            role="button"
            tabIndex={0}
            aria-label="ドラッグして並べ替え"
            onDragStart={(e) => handleDragStart(e, id)}
            onDragEnd={clearDrag}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            ⋮⋮
          </span>
        );
        return (
          <div
            key={id}
            className={`${styles.sortableRow} ${isDragging ? styles.sortableRowDragging : ""} ${isOver ? styles.sortableRowOver : ""}`}
            onDragOver={(e) => handleDragOver(e, id)}
            onDragLeave={() => {
              if (overId === id) setOverId(null);
            }}
            onDrop={(e) => void handleDrop(e, id)}
          >
            {renderItem(id, handle)}
          </div>
        );
      })}
    </div>
  );
}

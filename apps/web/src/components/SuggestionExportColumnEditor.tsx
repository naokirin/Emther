import { useEffect, useState } from "react";
import styles from "../styles/page.module.css";
import {
  SUGGESTION_EXPORT_COLUMNS,
  enableAllExportColumns,
  moveExportColumn,
  partitionExportColumns,
  toggleExportColumn,
  type SuggestionExportColumnId,
} from "@emther/core/suggestion-export";
import { loadSuggestionExportColumnIds, saveSuggestionExportColumnIds } from "../lib/suggestionExportColumns";

type Props = {
  value: SuggestionExportColumnId[];
  onChange: (next: SuggestionExportColumnId[]) => void;
};

/**
 * docs/suggestion_export.md Phase B β。
 * 列のオン／オフと有効列の並び替え。設定は呼び出し側が localStorage に保存する。
 */
export function SuggestionExportColumnEditor({ value, onChange }: Props) {
  const { enabled, disabled } = partitionExportColumns(value);
  const headerById = new Map(SUGGESTION_EXPORT_COLUMNS.map((c) => [c.id, c.header]));
  const allSelected = disabled.length === 0;

  return (
    <div style={{ display: "grid", gap: 8, fontSize: "0.85rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          className={styles.btnOutline}
          style={{ fontSize: "0.75rem", padding: "2px 8px" }}
          disabled={allSelected}
          onClick={() => onChange(enableAllExportColumns(value))}
        >
          すべての列を選択
        </button>
        {!allSelected && (
          <span className={styles.tableMuted} style={{ fontSize: "0.75rem" }}>
            未選択 {disabled.length} 列
          </span>
        )}
      </div>
      <div>
        <div className={styles.fieldCaption} style={{ marginBottom: 4 }}>
          出力する列（上から順）
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
          {enabled.map((id) => (
            <li
              key={id}
              style={{
                display: "grid",
                // 最長ラベル「AI進め方のアドバイス」に合わせ、ボタン列の開始位置を揃える
                gridTemplateColumns: "11.5rem auto",
                columnGap: 8,
                alignItems: "center",
              }}
            >
              <span style={{ lineHeight: 1.35 }}>{headerById.get(id) ?? id}</span>
              <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className={styles.btnOutline}
                  style={{ padding: "0 6px", fontSize: "0.75rem" }}
                  aria-label={`${headerById.get(id)}を上へ`}
                  onClick={() => onChange(moveExportColumn(value, id, "up"))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.btnOutline}
                  style={{ padding: "0 6px", fontSize: "0.75rem" }}
                  aria-label={`${headerById.get(id)}を下へ`}
                  onClick={() => onChange(moveExportColumn(value, id, "down"))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={styles.btnOutline}
                  style={{ padding: "0 6px", fontSize: "0.75rem" }}
                  aria-label={`${headerById.get(id)}を外す`}
                  onClick={() => onChange(toggleExportColumn(value, id, false))}
                >
                  外す
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {disabled.length > 0 && (
        <div>
          <div className={styles.fieldCaption} style={{ marginBottom: 4 }}>
            追加できる列
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {disabled.map((id) => (
              <button
                key={id}
                type="button"
                className={styles.btnOutline}
                style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                onClick={() => onChange(toggleExportColumn(value, id, true))}
              >
                ＋ {headerById.get(id) ?? id}
              </button>
            ))}
          </div>
        </div>
      )}
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

"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";

// ユーザー要望「メンバー・チーム名の表記揺れに対応できる仕組みが欲しい」対応。
// MultiSelectAutocomplete（既存の選択肢から選ぶ）とは違い、こちらは「新しい文字列を
// 自由入力してタグとして追加する」ための最小限の入力。別名（表記ゆれ）の登録はまさに
// 「候補一覧から選ぶ」のではなく「新しい呼び方を教える」操作なので、別コンポーネントにした。
// 見た目はMultiSelectAutocompleteの選択済みタグ表示（.multiSelectTag等）をそのまま流用する。
export function TagInput({
  values,
  onAdd,
  onRemove,
  placeholder = "入力してEnterまたは追加",
  label,
  disabled,
  style,
}: {
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setDraft("");
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, ...style }}>
      <div className={styles.multiSelectInputWrap} style={{ flex: 1, minWidth: 160 }}>
        {values.map((v) => (
          <span key={v} className={styles.multiSelectTag}>
            {v}
            <button
              type="button"
              className={styles.multiSelectTagRemove}
              onClick={() => onRemove(v)}
              disabled={disabled}
              aria-label={`${v}を解除`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          type="text"
          aria-label={label}
          className={styles.multiSelectInput}
          value={draft}
          placeholder={values.length === 0 ? placeholder : ""}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
              onRemove(values[values.length - 1]);
            }
          }}
        />
      </div>
      <button type="button" className={styles.btnOutline} onClick={commit} disabled={disabled || !draft.trim()}>
        追加
      </button>
    </div>
  );
}

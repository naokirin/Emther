import { useState } from "react";
import styles from "../styles/page.module.css";
import type { Goal } from "@emther/core/types";

/** テーマ ↔ Goal の手動紐づけ。ThemeOkrLinkEditorのGoal版（API の action:"link" を叩く）。 */
export function ThemeGoalLinkEditor({
  themeId,
  goalIds,
  goals,
  onSaved,
  disabled,
  compact,
}: {
  themeId: string;
  goalIds: string[];
  goals: Goal[];
  onSaved?: () => void | Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState<string[]>(goalIds);
  const [syncedKey, setSyncedKey] = useState(`${themeId}:${goalIds.join(",")}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncKey = `${themeId}:${goalIds.join(",")}`;
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    setDraft(goalIds);
    setError(null);
  }

  const dirty = [...draft].sort().join(",") !== [...goalIds].sort().join(",");

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!dirty || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/themes/${themeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link", goalIds: draft }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Goal紐づけの保存に失敗しました");
      await onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: compact ? 8 : 12 }}>
      <span className={styles.fieldCaption}>紐付ける Goal（手動）</span>
      {goals.length === 0 ? (
        <p className={styles.subtitle} style={{ margin: "4px 0 0" }}>
          Goal がまだありません。方針・目標で先にGoalを置いてください。
        </p>
      ) : (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: compact ? 6 : 10,
            maxHeight: compact ? 220 : 320,
            overflowY: "auto",
            padding: "8px 10px",
            border: "1px solid var(--input-border)",
            borderRadius: 6,
            fontSize: "0.875rem",
          }}
        >
          {goals.map((g) => (
            <label key={g.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={draft.includes(g.id)}
                disabled={disabled || busy}
                onChange={() => toggle(g.id)}
                style={{ marginTop: 2 }}
              />
              <span>{g.title.split("\n")[0]}</span>
            </label>
          ))}
        </div>
      )}
      <div className={styles.yieldActions} style={{ marginTop: 8 }}>
        <button
          type="button"
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={!dirty || busy || disabled || goals.length === 0}
          onClick={() => void handleSave()}
        >
          {busy ? "保存中…" : "Goal紐づけを保存"}
        </button>
      </div>
      {error && (
        <p className={styles.errorText} role="alert" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
    </div>
  );
}

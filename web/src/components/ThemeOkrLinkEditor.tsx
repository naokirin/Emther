"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import type { ObjectiveWithProgress } from "@/lib/types";

/** テーマ ↔ Objective / Key Result の手動紐づけ。API の action:"link" を叩く。 */
export function ThemeOkrLinkEditor({
  themeId,
  objectiveIds,
  keyResultIds,
  objectives,
  onSaved,
  disabled,
  compact,
}: {
  themeId: string;
  objectiveIds: string[];
  keyResultIds: string[];
  objectives: ObjectiveWithProgress[];
  onSaved?: () => void | Promise<void>;
  disabled?: boolean;
  /** ダッシュボード等の狭いパネル向けに余白を抑える */
  compact?: boolean;
}) {
  const [objDraft, setObjDraft] = useState<string[]>(objectiveIds);
  const [krDraft, setKrDraft] = useState<string[]>(keyResultIds);
  const [syncedKey, setSyncedKey] = useState(`${themeId}:${objectiveIds.join(",")}:${keyResultIds.join(",")}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncKey = `${themeId}:${objectiveIds.join(",")}:${keyResultIds.join(",")}`;
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    setObjDraft(objectiveIds);
    setKrDraft(keyResultIds);
    setError(null);
  }

  const dirty =
    [...objDraft].sort().join(",") !== [...objectiveIds].sort().join(",") ||
    [...krDraft].sort().join(",") !== [...keyResultIds].sort().join(",");

  function toggleObj(id: string) {
    setObjDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleKr(id: string) {
    setKrDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!dirty || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/themes/${themeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          objectiveIds: objDraft,
          keyResultIds: krDraft,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "OKR紐づけの保存に失敗しました");
      await onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: compact ? 8 : 12 }}>
      <span className={styles.fieldCaption}>紐付ける Objective / Key Result（手動）</span>
      {objectives.length === 0 ? (
        <p className={styles.subtitle} style={{ margin: "4px 0 0" }}>
          Objective がまだありません。方針・目標で先に OKR を置いてください。
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
            fontSize: "0.8125rem",
          }}
        >
          {objectives.map((o) => (
            <div key={o.id}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={objDraft.includes(o.id)}
                  disabled={disabled || busy}
                  onChange={() => toggleObj(o.id)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>{o.title.split("\n")[0]}</strong>
                  <span className={styles.tableMuted}>（Objective）</span>
                </span>
              </label>
              {o.keyResults.length > 0 && (
                <div style={{ marginLeft: 22, marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                  {o.keyResults.map((kr) => (
                    <label
                      key={kr.id}
                      style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}
                    >
                      <input
                        type="checkbox"
                        checked={krDraft.includes(kr.id)}
                        disabled={disabled || busy}
                        onChange={() => toggleKr(kr.id)}
                        style={{ marginTop: 2 }}
                      />
                      <span>
                        {kr.title.split("\n")[0]}
                        <span className={styles.tableMuted}>（KR）</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className={styles.yieldActions} style={{ marginTop: 8 }}>
        <button
          type="button"
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={!dirty || busy || disabled || objectives.length === 0}
          onClick={() => void handleSave()}
        >
          {busy ? "保存中…" : "OKR紐づけを保存"}
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

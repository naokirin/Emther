import { useState } from "react";
import styles from "../styles/page.module.css";
import { api, rpcInit } from "../lib/api-client";
import type { Goal } from "@emther/core/types";
import { treeTitle } from "./org/treeTitle";

type SharedProps = {
  goals: Goal[];
  /** 編集対象自身（作成時は null）。候補から除外する。 */
  excludeGoalId?: string | null;
  disabled?: boolean;
  compact?: boolean;
};

/** 作成フォーム用: 選択を親へ返すだけ（POST 時にまとめて送る）。 */
export function GoalParentLinkPicker({
  goals,
  excludeGoalId,
  value,
  onChange,
  disabled,
  compact,
}: SharedProps & {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const candidates = goals.filter((g) => g.id !== excludeGoalId);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  return (
    <div style={{ marginTop: compact ? 8 : 12 }}>
      <span className={styles.fieldCaption}>上位 Goal（多対多・任意）</span>
      <p className={styles.subtitle} style={{ margin: "4px 0 0" }}>
        チーム階層とは独立です。複数の上位 Goal に紐づけられます。
      </p>
      {candidates.length === 0 ? (
        <p className={styles.subtitle} style={{ margin: "4px 0 0" }}>
          紐づけ可能な Goal がまだありません。
        </p>
      ) : (
        <ParentChecklist
          candidates={candidates}
          draft={value}
          disabled={disabled}
          compact={compact}
          onToggle={toggle}
        />
      )}
    </div>
  );
}

/** 編集用: ThemeGoalLinkEditor と同型で PATCH 保存。 */
export function GoalParentLinkEditor({
  goalId,
  parentGoalIds,
  goals,
  onSaved,
  disabled,
  compact,
}: SharedProps & {
  goalId: string;
  parentGoalIds: string[];
  onSaved?: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<string[]>(parentGoalIds);
  const [syncedKey, setSyncedKey] = useState(`${goalId}:${parentGoalIds.join(",")}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncKey = `${goalId}:${parentGoalIds.join(",")}`;
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    setDraft(parentGoalIds);
    setError(null);
  }

  const candidates = goals.filter((g) => g.id !== goalId);
  const dirty = [...draft].sort().join(",") !== [...parentGoalIds].sort().join(",");

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!dirty || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.api.org.goals[":id"].$patch(
        rpcInit({
          param: { id: goalId },
          json: { parentGoalIds: draft },
        }),
      );
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "上位Goal紐づけの保存に失敗しました");
      await onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: compact ? 8 : 12 }}>
      <span className={styles.fieldCaption}>上位 Goal（多対多）</span>
      <p className={styles.subtitle} style={{ margin: "4px 0 0" }}>
        チーム階層とは独立です。複数の上位 Goal に紐づけられます。
      </p>
      {candidates.length === 0 ? (
        <p className={styles.subtitle} style={{ margin: "4px 0 0" }}>
          紐づけ可能な他の Goal がありません。
        </p>
      ) : (
        <ParentChecklist
          candidates={candidates}
          draft={draft}
          disabled={disabled || busy}
          compact={compact}
          onToggle={toggle}
        />
      )}
      <div className={styles.yieldActions} style={{ marginTop: 8 }}>
        <button
          type="button"
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={!dirty || busy || disabled || candidates.length === 0}
          onClick={() => void handleSave()}
        >
          {busy ? "保存中…" : "上位Goal紐づけを保存"}
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

function ParentChecklist({
  candidates,
  draft,
  disabled,
  compact,
  onToggle,
}: {
  candidates: Goal[];
  draft: string[];
  disabled?: boolean;
  compact?: boolean;
  onToggle: (id: string) => void;
}) {
  return (
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
      {candidates.map((g) => (
        <label key={g.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={draft.includes(g.id)}
            disabled={disabled}
            onChange={() => onToggle(g.id)}
            style={{ marginTop: 2 }}
          />
          <span>{treeTitle(g.title)}</span>
        </label>
      ))}
    </div>
  );
}

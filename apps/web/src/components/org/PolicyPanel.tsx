import { useState } from "react";
import styles from "../../styles/page.module.css";
import { Select } from "../Select";
import { useEntityHistory } from "../../lib/queries";
import { type PolicyCategory, type PolicyEntry } from "@emther/core/types";
import { treeTitle } from "./treeTitle";

type Props = {
  policies: PolicyEntry[];
  policiesLoaded: boolean;
  refreshPolicies: () => Promise<void>;
};

const CATEGORY_OPTIONS: { value: PolicyCategory | ""; label: string }[] = [
  { value: "", label: "カテゴリなし" },
  { value: "value", label: "大切にすること" },
  { value: "priority", label: "優先すること" },
  { value: "avoid", label: "やらないこと" },
  { value: "principle", label: "判断原則" },
  { value: "other", label: "その他" },
];

function categoryLabel(category: PolicyCategory | undefined): string {
  return CATEGORY_OPTIONS.find((o) => o.value === (category ?? ""))?.label ?? "";
}

// Policy（判断原則）。goal_policy_model.md の方針どおり固定欄にはせず、Standing Background
// と同じ「自由記述の複数エントリ」を左ツリー入口＋右パネルの一覧・編集で扱う。
export function PolicyPanel({ policies, policiesLoaded, refreshPolicies }: Props) {
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const selectedPolicy = editingPolicyId ? policies.find((p) => p.id === editingPolicyId) ?? null : null;
  const { history: policyHistory } = useEntityHistory("org", selectedPolicy?.id ?? null);
  const [showArchivedPolicies, setShowArchivedPolicies] = useState(false);
  const visiblePolicies = policies.filter((p) => showArchivedPolicies || !p.archivedAt);

  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState<PolicyCategory | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editText, setEditText] = useState("");
  const [editCategory, setEditCategory] = useState<PolicyCategory | "">("");
  const [editArchived, setEditArchived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function beginEdit(entry: PolicyEntry) {
    setEditText(entry.text);
    setEditCategory(entry.category ?? "");
    setEditArchived(!!entry.archivedAt);
    setEditError(null);
    setEditingPolicyId(entry.id);
  }

  function cancelEdit() {
    setEditingPolicyId(null);
    setEditError(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/org/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newText.trim(), category: newCategory || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "追加に失敗しました");
      setNewText("");
      setNewCategory("");
      await refreshPolicies();
      beginEdit(data.policy);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const dirty =
    !!selectedPolicy &&
    (editText !== selectedPolicy.text ||
      editCategory !== (selectedPolicy.category ?? "") ||
      editArchived !== !!selectedPolicy.archivedAt);

  async function handleSave() {
    if (!selectedPolicy || !editText.trim() || !dirty) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/org/policies/${selectedPolicy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editText, category: editCategory || null, archived: editArchived }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      await refreshPolicies();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm("このPolicyを削除しますか？")) return;
    await fetch(`/api/org/policies/${id}`, { method: "DELETE" });
    if (editingPolicyId === id) setEditingPolicyId(null);
    await refreshPolicies();
  }

  return (
    <>
      {!selectedPolicy && (
        <>
          <h3 style={{ marginTop: 4, marginBottom: 8, fontSize: "0.875rem" }}>新規追加</h3>
          <form onSubmit={handleAdd}>
            <div className={styles.field}>
              <label>
                内容（大切にすること／優先すること／やらないこと／判断に迷ったときの原則、など）
                <textarea rows={3} value={newText} onChange={(e) => setNewText(e.target.value)} />
              </label>
            </div>
            <div className={styles.field}>
              <Select
                label="カテゴリ（任意）"
                value={newCategory}
                onChange={(v) => setNewCategory(v as PolicyCategory | "")}
                options={CATEGORY_OPTIONS}
                style={{ width: "100%" }}
              />
            </div>
            {error && (
              <p className={styles.errorText} role="alert">
                {error}
              </p>
            )}
            <button className={styles.primaryBtn} type="submit" style={{ width: "auto" }} disabled={submitting || !newText.trim()}>
              {submitting ? "追加中…" : "追加"}
            </button>
          </form>

          <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid var(--input-border)" }} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: "0.875rem" }}>一覧</h3>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
              <input type="checkbox" checked={showArchivedPolicies} onChange={(e) => setShowArchivedPolicies(e.target.checked)} />
              アーカイブも表示
            </label>
          </div>
          {!policiesLoaded ? (
            <p className={styles.subtitle}>読み込み中…</p>
          ) : visiblePolicies.length === 0 ? (
            <p className={styles.subtitle}>まだPolicyがありません。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visiblePolicies.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => beginEdit(p)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "1px solid var(--input-border)",
                    borderRadius: 8,
                    background: "var(--panel-bg, transparent)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{treeTitle(p.text)}</div>
                  <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {categoryLabel(p.category) || "カテゴリなし"}
                    {p.archivedAt ? " · アーカイブ" : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {selectedPolicy && (
        <>
          <div className={styles.editorPath}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className={styles.btnOutline} onClick={cancelEdit}>
                一覧に戻る
              </button>
              <button className={styles.primaryBtn} style={{ width: "auto" }} onClick={handleSave} disabled={saving || !editText.trim() || !dirty}>
                {saving ? "保存中…" : dirty ? "保存" : "保存済み"}
              </button>
              <button className={styles.btnOutline} onClick={() => handleRemove(selectedPolicy.id)}>
                削除
              </button>
            </div>
          </div>
          {editError && (
            <p className={styles.errorText} role="alert">
              {editError}
            </p>
          )}
          <div className={styles.field}>
            <label>
              内容
              <textarea rows={4} value={editText} onChange={(e) => setEditText(e.target.value)} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className={styles.field} style={{ flex: 1, minWidth: 160 }}>
              <Select
                label="カテゴリ（任意）"
                value={editCategory}
                onChange={(v) => setEditCategory(v as PolicyCategory | "")}
                options={CATEGORY_OPTIONS}
              />
            </div>
            <div className={styles.field} style={{ flex: 1, minWidth: 140 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 22 }}>
                <input type="checkbox" checked={editArchived} onChange={(e) => setEditArchived(e.target.checked)} />
                アーカイブする（注入しない）
              </label>
            </div>
          </div>
          {policyHistory.length > 0 && (
            <>
              <h3 style={{ marginTop: 20, marginBottom: 6, fontSize: "0.875rem" }}>変更履歴</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {policyHistory.slice(0, 8).map((ev) => (
                  <li key={ev.id}>{ev.text}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}

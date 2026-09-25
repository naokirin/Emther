import { useState } from "react";
import styles from "../../styles/page.module.css";
import { Select } from "../Select";
import { api, rpcInit } from "../../lib/api-client";
import { useEntityHistory } from "../../lib/queries";
import { type PolicyCategory, type PolicyEntry } from "@emther/core/types";
import { mergeSubsequenceOrder } from "@emther/core/sort-order";
import type { PoliciesResponse, PolicyMutationResponse } from "@emther/api-contract";
import { treeTitle } from "./treeTitle";
import { SortableList } from "./SortableList";

type Props = {
  policies: PolicyEntry[];
  policiesLoaded: boolean;
  refreshPolicies: () => Promise<void>;
  editingPolicyId: string | null;
  onSelectPolicy: (policy: PolicyEntry) => void;
  onBack: () => void;
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

// Policy（判断原則）。一覧（作成トグル・DnD）と編集ビューを分離。
export function PolicyPanel({
  policies,
  policiesLoaded,
  refreshPolicies,
  editingPolicyId,
  onSelectPolicy,
  onBack,
}: Props) {
  const selectedPolicy = editingPolicyId ? policies.find((p) => p.id === editingPolicyId) ?? null : null;
  const { history: policyHistory } = useEntityHistory("org", selectedPolicy?.id ?? null);
  const [showArchivedPolicies, setShowArchivedPolicies] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const visiblePolicies = policies.filter((p) => showArchivedPolicies || !p.archivedAt);

  const [newText, setNewText] = useState("");
  const [newElaboration, setNewElaboration] = useState("");
  const [newCategory, setNewCategory] = useState<PolicyCategory | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editText, setEditText] = useState(selectedPolicy?.text ?? "");
  const [editElaboration, setEditElaboration] = useState(selectedPolicy?.elaboration ?? "");
  const [editCategory, setEditCategory] = useState<PolicyCategory | "">(selectedPolicy?.category ?? "");
  const [editArchived, setEditArchived] = useState(!!selectedPolicy?.archivedAt);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // 選択Policyが変わったときだけ編集フォームを載せ替える。
  // effect 内 setState を避け、描画中の「prev id との差分」で調整する。
  const [syncedPolicyId, setSyncedPolicyId] = useState(selectedPolicy?.id ?? null);
  if (selectedPolicy && selectedPolicy.id !== syncedPolicyId) {
    setSyncedPolicyId(selectedPolicy.id);
    setEditText(selectedPolicy.text);
    setEditElaboration(selectedPolicy.elaboration ?? "");
    setEditCategory(selectedPolicy.category ?? "");
    setEditArchived(!!selectedPolicy.archivedAt);
    setEditError(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.api.org.policies.$post({
        json: {
          text: newText.trim(),
          elaboration: newElaboration.trim() || undefined,
          category: newCategory || undefined,
        },
      });
      const data = (await res.json()) as PolicyMutationResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "追加に失敗しました");
      setNewText("");
      setNewElaboration("");
      setNewCategory("");
      setCreating(false);
      await refreshPolicies();
      if (data.policy) onSelectPolicy(data.policy);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const dirty =
    !!selectedPolicy &&
    (editText !== selectedPolicy.text ||
      editElaboration !== (selectedPolicy.elaboration ?? "") ||
      editCategory !== (selectedPolicy.category ?? "") ||
      editArchived !== !!selectedPolicy.archivedAt);

  async function handleSave() {
    if (!selectedPolicy || !editText.trim() || !dirty) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await api.api.org.policies[":id"].$patch(
        rpcInit({
          param: { id: selectedPolicy.id },
          json: {
            text: editText,
            elaboration: editElaboration,
            category: editCategory || null,
            archived: editArchived,
          },
        }),
      );
      const data = (await res.json()) as { error?: string };
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
    await api.api.org.policies[":id"].$delete({ param: { id } });
    onBack();
    await refreshPolicies();
  }

  async function handleReorderVisible(orderedVisibleIds: string[]) {
    setReorderError(null);
    const fullIds = policies.map((p) => p.id);
    const merged = mergeSubsequenceOrder(fullIds, orderedVisibleIds);
    const res = await api.api.org.policies.reorder.$post({ json: { ids: merged } });
    const data = (await res.json().catch(() => null)) as (PoliciesResponse & { error?: string }) | null;
    if (!res.ok) throw new Error(data?.error ?? "並べ替えに失敗しました");
    await refreshPolicies();
  }

  if (!selectedPolicy) {
    return (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Policy</h3>
          {!creating && (
            <button
              type="button"
              className={styles.primaryBtn}
              style={{ width: "auto", fontSize: "0.8rem" }}
              onClick={() => setCreating(true)}
            >
              ＋ 新規追加
            </button>
          )}
        </div>

        {creating && (
          <>
            <h3 style={{ marginTop: 4, marginBottom: 8, fontSize: "0.875rem" }}>新規追加</h3>
            <form onSubmit={handleAdd}>
              <div className={styles.field}>
                <label>
                  見出し（組織・チームの判断原則）
                  <textarea rows={3} value={newText} onChange={(e) => setNewText(e.target.value)} />
                </label>
              </div>
              <div className={styles.field}>
                <label>
                  補足（任意 · 解釈を閉じる説明）
                  <textarea rows={2} value={newElaboration} onChange={(e) => setNewElaboration(e.target.value)} />
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
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className={styles.primaryBtn}
                  type="submit"
                  style={{ width: "auto" }}
                  disabled={submitting || !newText.trim()}
                >
                  {submitting ? "追加中…" : "追加"}
                </button>
                <button
                  type="button"
                  className={styles.btnOutline}
                  disabled={submitting}
                  onClick={() => {
                    setCreating(false);
                    setError(null);
                  }}
                >
                  キャンセル
                </button>
              </div>
            </form>
            <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid var(--input-border)" }} />
          </>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: "0.875rem" }}>一覧</h3>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={showArchivedPolicies}
              onChange={(e) => setShowArchivedPolicies(e.target.checked)}
            />
            アーカイブも表示
          </label>
        </div>
        {reorderError && (
          <p className={styles.errorText} role="alert">
            {reorderError}
          </p>
        )}
        {!policiesLoaded ? (
          <p className={styles.subtitle}>読み込み中…</p>
        ) : visiblePolicies.length === 0 ? (
          <p className={styles.subtitle}>まだPolicyがありません。</p>
        ) : (
          <SortableList
            ids={visiblePolicies.map((p) => p.id)}
            onReorder={async (orderedIds) => {
              try {
                await handleReorderVisible(orderedIds);
              } catch (err) {
                setReorderError((err as Error).message);
              }
            }}
            renderItem={(id, handle) => {
              const p = visiblePolicies.find((x) => x.id === id);
              if (!p) return null;
              return (
                <>
                  {handle}
                  <button type="button" className={styles.sortableRowBody} onClick={() => onSelectPolicy(p)}>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{treeTitle(p.text)}</div>
                    {p.elaboration ? (
                      <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        {treeTitle(p.elaboration)}
                      </div>
                    ) : null}
                    <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {categoryLabel(p.category) || "カテゴリなし"}
                      {p.archivedAt ? " · アーカイブ" : ""}
                    </div>
                  </button>
                </>
              );
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className={styles.editorPath}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className={styles.btnOutline} onClick={onBack}>
            ← 一覧へ
          </button>
          <button
            className={styles.primaryBtn}
            style={{ width: "auto" }}
            onClick={handleSave}
            disabled={saving || !editText.trim() || !dirty}
          >
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
          見出し（組織・チームの判断原則）
          <textarea rows={4} value={editText} onChange={(e) => setEditText(e.target.value)} />
        </label>
      </div>
      <div className={styles.field}>
        <label>
          補足（任意 · 解釈を閉じる説明）
          <textarea rows={3} value={editElaboration} onChange={(e) => setEditElaboration(e.target.value)} />
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
  );
}

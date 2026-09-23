import { useState } from "react";
import styles from "../../styles/page.module.css";
import { Select } from "../Select";
import { api, rpcInit } from "../../lib/api-client";
import { useEntityHistory } from "../../lib/queries";
import { type OrgBackgroundEntry } from "@emther/core/types";
import { treeTitle } from "./treeTitle";

type Props = {
  backgrounds: OrgBackgroundEntry[];
  backgroundsLoaded: boolean;
  refreshBackgrounds: () => Promise<void>;
};

function parseTagInput(raw: string): string[] {
  return raw
    .split(/[,、]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Standing Background（長期の背景事実）。Strategy と同様、左ツリーは入口だけで
// 追加・一覧・編集・削除は右パネルの専用ビューで行う。
export function StandingBackgroundPanel({ backgrounds, backgroundsLoaded, refreshBackgrounds }: Props) {
  const [editingBackgroundId, setEditingBackgroundId] = useState<string | null>(null);
  const selectedBackground =
    editingBackgroundId ? backgrounds.find((b) => b.id === editingBackgroundId) ?? null : null;
  const { history: backgroundHistory } = useEntityHistory("org", selectedBackground?.id ?? null);
  const [showArchivedBackgrounds, setShowArchivedBackgrounds] = useState(false);
  const visibleBackgrounds = backgrounds.filter((b) => showArchivedBackgrounds || b.status === "active");

  const [newBgTitle, setNewBgTitle] = useState("");
  const [newBgFact, setNewBgFact] = useState("");
  const [newBgImplication, setNewBgImplication] = useState("");
  const [newBgOccurredOn, setNewBgOccurredOn] = useState("");
  const [newBgTags, setNewBgTags] = useState("");
  const [newBgScope, setNewBgScope] = useState<"always" | "tagged">("always");
  const [bgSubmitting, setBgSubmitting] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);

  const [editBgTitle, setEditBgTitle] = useState("");
  const [editBgFact, setEditBgFact] = useState("");
  const [editBgImplication, setEditBgImplication] = useState("");
  const [editBgOccurredOn, setEditBgOccurredOn] = useState("");
  const [editBgTags, setEditBgTags] = useState("");
  const [editBgScope, setEditBgScope] = useState<"always" | "tagged">("always");
  const [editBgStatus, setEditBgStatus] = useState<"active" | "archived">("active");
  const [bgSaving, setBgSaving] = useState(false);
  const [bgEditError, setBgEditError] = useState<string | null>(null);

  function beginEditBackground(entry: OrgBackgroundEntry) {
    setEditBgTitle(entry.title);
    setEditBgFact(entry.fact);
    setEditBgImplication(entry.implication);
    setEditBgOccurredOn(entry.occurredOn ?? "");
    setEditBgTags(entry.tags.join(", "));
    setEditBgScope(entry.scope);
    setEditBgStatus(entry.status);
    setBgEditError(null);
    setEditingBackgroundId(entry.id);
  }

  function cancelEditBackground() {
    setEditingBackgroundId(null);
    setBgEditError(null);
  }

  async function handleAddBackground(e: React.FormEvent) {
    e.preventDefault();
    if (!newBgTitle.trim() || !newBgFact.trim()) return;
    setBgSubmitting(true);
    setBgError(null);
    try {
      const res = await api.api.org.background.$post({
        json: {
          title: newBgTitle.trim(),
          fact: newBgFact.trim(),
          implication: newBgImplication.trim() || undefined,
          occurredOn: newBgOccurredOn.trim() || undefined,
          tags: parseTagInput(newBgTags),
          scope: newBgScope,
        },
      });
      const data = (await res.json()) as { error?: string; background?: OrgBackgroundEntry };
      if (!res.ok) throw new Error(data.error ?? "追加に失敗しました");
      setNewBgTitle("");
      setNewBgFact("");
      setNewBgImplication("");
      setNewBgOccurredOn("");
      setNewBgTags("");
      setNewBgScope("always");
      await refreshBackgrounds();
      beginEditBackground(data.background!);
    } catch (err) {
      setBgError((err as Error).message);
    } finally {
      setBgSubmitting(false);
    }
  }

  const backgroundDirty =
    !!selectedBackground &&
    (editBgTitle !== selectedBackground.title ||
      editBgFact !== selectedBackground.fact ||
      editBgImplication !== selectedBackground.implication ||
      editBgOccurredOn !== (selectedBackground.occurredOn ?? "") ||
      editBgTags !== selectedBackground.tags.join(", ") ||
      editBgScope !== selectedBackground.scope ||
      editBgStatus !== selectedBackground.status);

  async function handleSaveBackground() {
    if (!selectedBackground || !editBgTitle.trim() || !editBgFact.trim() || !backgroundDirty) return;
    setBgSaving(true);
    setBgEditError(null);
    try {
      const res = await api.api.org.background[":id"].$patch(rpcInit({
        param: { id: selectedBackground.id },
        json: {
          title: editBgTitle,
          fact: editBgFact,
          implication: editBgImplication,
          occurredOn: editBgOccurredOn,
          tags: parseTagInput(editBgTags),
          scope: editBgScope,
          status: editBgStatus,
        },
      }));
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      await refreshBackgrounds();
    } catch (err) {
      setBgEditError((err as Error).message);
    } finally {
      setBgSaving(false);
    }
  }

  async function handleRemoveBackground(id: string) {
    if (!confirm("この Standing Background を削除しますか？")) return;
    await api.api.org.background[":id"].$delete({ param: { id } });
    if (editingBackgroundId === id) setEditingBackgroundId(null);
    await refreshBackgrounds();
  }

  return (
    <>
      {!selectedBackground && (
        <>
          <h3 style={{ marginTop: 4, marginBottom: 8, fontSize: "0.875rem" }}>新規追加</h3>
          <form onSubmit={handleAddBackground}>
            <div className={styles.field}>
              <label>見出し
              <input
                value={newBgTitle}
                onChange={(e) => setNewBgTitle(e.target.value)}
                placeholder="例: 2024 個人情報漏洩"
                style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
              /></label>
            </div>
            <div className={styles.field}>
              <label>事実（いつ・何が起きたか）
              <textarea rows={3} value={newBgFact} onChange={(e) => setNewBgFact(e.target.value)} /></label>
            </div>
            <div className={styles.field}>
              <label>いまの判断への含意（任意）
              <textarea
                rows={2}
                value={newBgImplication}
                onChange={(e) => setNewBgImplication(e.target.value)}
              /></label>
            </div>
            <div className={styles.field}>
              <label>時期（任意・例: 2024-Q3）
              <input
                value={newBgOccurredOn}
                onChange={(e) => setNewBgOccurredOn(e.target.value)}
                style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
              /></label>
            </div>
            <div className={styles.field}>
              <label>タグ（カンマ区切り）
              <input
                value={newBgTags}
                onChange={(e) => setNewBgTags(e.target.value)}
                placeholder="security, trust"
                style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
              /></label>
            </div>
            <div className={styles.field}>
              <Select
                label="注入範囲"
                value={newBgScope}
                onChange={(v) => setNewBgScope(v as "always" | "tagged")}
                options={[
                  { value: "always", label: "always（ほぼ全 Run）" },
                  { value: "tagged", label: "tagged（手がかりがあるときだけ）" },
                ]}
                style={{ width: "100%" }}
              />
            </div>
            {bgError && <p className={styles.errorText} role="alert">{bgError}</p>}
            <button
              className={styles.primaryBtn}
              type="submit"
              style={{ width: "auto" }}
              disabled={bgSubmitting || !newBgTitle.trim() || !newBgFact.trim()}
            >
              {bgSubmitting ? "追加中…" : "追加"}
            </button>
          </form>

          <hr style={{ margin: "20px 0", border: 0, borderTop: "1px solid var(--input-border)" }} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: "0.875rem" }}>一覧</h3>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
              <input
                type="checkbox"
                checked={showArchivedBackgrounds}
                onChange={(e) => setShowArchivedBackgrounds(e.target.checked)}
              />
              アーカイブも表示
            </label>
          </div>
          {!backgroundsLoaded ? (
            <p className={styles.subtitle}>読み込み中…</p>
          ) : visibleBackgrounds.length === 0 ? (
            <p className={styles.subtitle}>まだ背景事実がありません。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visibleBackgrounds.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => beginEditBackground(b)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "1px solid var(--input-border)",
                    borderRadius: 8,
                    background: "var(--panel-bg, transparent)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                    {b.occurredOn ? `[${b.occurredOn}] ` : ""}
                    {treeTitle(b.title)}
                  </div>
                  <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {b.scope === "always" ? "always" : "tagged"}
                    {b.status === "archived" ? " · アーカイブ" : ""}
                    {b.tags.length > 0 ? ` · ${b.tags.join(", ")}` : ""}
                  </div>
                  <div style={{ marginTop: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}>
                    {b.fact.length > 120 ? `${b.fact.slice(0, 120)}…` : b.fact}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {selectedBackground && (
        <>
          <div className={styles.editorPath}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className={styles.btnOutline} onClick={cancelEditBackground}>
                一覧に戻る
              </button>
              <button
                className={styles.primaryBtn}
                style={{ width: "auto" }}
                onClick={handleSaveBackground}
                disabled={bgSaving || !editBgTitle.trim() || !editBgFact.trim() || !backgroundDirty}
              >
                {bgSaving ? "保存中…" : backgroundDirty ? "保存" : "保存済み"}
              </button>
              <button className={styles.btnOutline} onClick={() => handleRemoveBackground(selectedBackground.id)}>
                削除
              </button>
            </div>
          </div>
          {bgEditError && <p className={styles.errorText} role="alert">{bgEditError}</p>}
          <div className={styles.field}>
            <label>見出し
            <input
              value={editBgTitle}
              onChange={(e) => setEditBgTitle(e.target.value)}
              style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
            /></label>
          </div>
          <div className={styles.field}>
            <label>事実（いつ・何が起きたか）
            <textarea rows={4} value={editBgFact} onChange={(e) => setEditBgFact(e.target.value)} /></label>
          </div>
          <div className={styles.field}>
            <label>いまの判断への含意（任意）
            <textarea
              rows={3}
              value={editBgImplication}
              onChange={(e) => setEditBgImplication(e.target.value)}
            /></label>
          </div>
          <div className={styles.field}>
            <label>時期（任意・例: 2024-Q3）
            <input
              value={editBgOccurredOn}
              onChange={(e) => setEditBgOccurredOn(e.target.value)}
              style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
            /></label>
          </div>
          <div className={styles.field}>
            <label>タグ（カンマ区切り）
            <input
              value={editBgTags}
              onChange={(e) => setEditBgTags(e.target.value)}
              placeholder="security, trust"
              style={{ width: "100%", border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px" }}
            /></label>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className={styles.field} style={{ flex: 1, minWidth: 160 }}>
              <Select
                label="注入範囲"
                value={editBgScope}
                onChange={(v) => setEditBgScope(v as "always" | "tagged")}
                options={[
                  { value: "always", label: "always（ほぼ全 Run）" },
                  { value: "tagged", label: "tagged（手がかりがあるときだけ）" },
                ]}
              />
            </div>
            <div className={styles.field} style={{ flex: 1, minWidth: 140 }}>
              <Select
                label="状態"
                value={editBgStatus}
                onChange={(v) => setEditBgStatus(v as "active" | "archived")}
                options={[
                  { value: "active", label: "active（注入する）" },
                  { value: "archived", label: "archived（注入しない）" },
                ]}
              />
            </div>
          </div>
          {backgroundHistory.length > 0 && (
            <>
              <h3 style={{ marginTop: 20, marginBottom: 6, fontSize: "0.875rem" }}>変更履歴</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {backgroundHistory.slice(0, 8).map((ev) => (
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

import { useEffect, useState } from "react";
import styles from "../../styles/page.module.css";
import { api, rpcInit } from "../../lib/api-client";
import type { GlossaryEntry } from "@emther/core/glossary-store";

export function GlossaryPanel() {
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");

  const [creating, setCreating] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const [newReading, setNewReading] = useState("");
  const [newMeaning, setNewMeaning] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTerm, setEditTerm] = useState("");
  const [editMeaning, setEditMeaning] = useState("");

  async function loadGlossary() {
    try {
      const res = await api.api.glossary.$get();
      const data = (await res.json().catch(() => null)) as { entries?: GlossaryEntry[] } | null;
      if (res.ok && Array.isArray(data?.entries)) {
        setEntries(data.entries);
      }
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void loadGlossary();
  }, []);

  async function handleAdd() {
    if (!newTerm.trim() || !newMeaning.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.api.glossary.$post({
        json: {
          term: newTerm.trim(),
          reading: newReading.trim() || undefined,
          meaning: newMeaning.trim(),
          category: newCategory.trim() || undefined,
        },
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "登録に失敗しました");
      await loadGlossary();
      setNewTerm("");
      setNewReading("");
      setNewMeaning("");
      setNewCategory("");
      setCreating(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("この用語を削除しますか？")) return;
    try {
      const res = await api.api.glossary[":id"].$delete({ param: { id } });
      if (res.ok) {
        await loadGlossary();
      }
    } catch {
      // ignore
    }
  }

  async function handleUpdate(id: string) {
    if (!editTerm.trim() || !editMeaning.trim()) return;
    try {
      const res = await api.api.glossary[":id"].$patch(rpcInit({
        param: { id },
        json: { term: editTerm.trim(), meaning: editMeaning.trim() },
      }));
      if (res.ok) {
        setEditingId(null);
        await loadGlossary();
      }
    } catch {
      // ignore
    }
  }

  const filtered = entries.filter(
    (e) =>
      e.term.toLowerCase().includes(search.toLowerCase()) ||
      e.meaning.toLowerCase().includes(search.toLowerCase()) ||
      (e.reading && e.reading.toLowerCase().includes(search.toLowerCase())) ||
      (e.category && e.category.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Glossary（社内用語・コンテキスト辞書）</h3>
        {!creating && (
          <button
            type="button"
            className={styles.primaryBtn}
            style={{ width: "auto", fontSize: "0.8rem" }}
            onClick={() => setCreating(true)}
          >
            ＋ 用語を追加
          </button>
        )}
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 12px" }}>
        組織固有の略語・プロジェクト名・専門用語を登録しておくと、AI（Lead Agentやローカル要約）がコンテキストとして自動参照し、誤読やハルシネーションを防止します。
      </p>

      {creating && (
        <div
          style={{
            padding: 14,
            backgroundColor: "var(--surface)",
            borderRadius: 8,
            border: "1px solid var(--border)",
            borderLeft: "4px solid var(--accent)",
            marginBottom: 16,
          }}
        >
          <strong style={{ fontSize: "0.9rem" }}>📖 新しい用語を登録</strong>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8, marginBottom: 8 }}>
            <div className={styles.field}>
              <label>
                用語・略語（必須）
                <input
                  type="text"
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  placeholder="例: PRD, SRE, オンプレ移行PJ"
                />
              </label>
            </div>
            <div className={styles.field}>
              <label>
                カテゴリ（任意）
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="例: プロジェクト, 役職・組織, 技術"
                />
              </label>
            </div>
          </div>
          <div className={styles.field} style={{ marginBottom: 8 }}>
            <label>
              読み方（任意）
              <input
                type="text"
                value={newReading}
                onChange={(e) => setNewReading(e.target.value)}
                placeholder="例: ピーアールディー"
              />
            </label>
          </div>
          <div className={styles.field} style={{ marginBottom: 12 }}>
            <label>
              意味・説明（必須）
              <textarea
                value={newMeaning}
                onChange={(e) => setNewMeaning(e.target.value)}
                placeholder="例: Product Requirements Document。機能要件仕様書のこと。"
                rows={3}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className={styles.primaryBtn}
              style={{ width: "auto" }}
              disabled={submitting || !newTerm.trim() || !newMeaning.trim()}
              onClick={() => void handleAdd()}
            >
              {submitting ? "登録中…" : "登録"}
            </button>
            <button
              type="button"
              className={styles.btnOutline}
              style={{ width: "auto" }}
              disabled={submitting}
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
            >
              キャンセル
            </button>
          </div>
          {error && (
            <p className={styles.errorText} role="alert" style={{ marginTop: 8 }}>
              {error}
            </p>
          )}
        </div>
      )}

      <div className={styles.field} style={{ marginBottom: 12, maxWidth: 360 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="用語や説明を検索..."
        />
      </div>

      {!loaded ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : filtered.length === 0 ? (
        <p className={styles.subtitle}>
          {search ? "一致する用語は見つかりませんでした。" : "登録済みの用語はありません。「＋ 用語を追加」から登録してください。"}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((item) => (
            <div
              key={item.id}
              style={{
                padding: "10px 12px",
                border: "1px solid var(--input-border)",
                borderRadius: 8,
                background: "var(--panel-bg, transparent)",
              }}
            >
              {editingId === item.id ? (
                <div>
                  <div className={styles.field} style={{ marginBottom: 8 }}>
                    <label>
                      用語・略語
                      <input
                        type="text"
                        value={editTerm}
                        onChange={(e) => setEditTerm(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className={styles.field} style={{ marginBottom: 8 }}>
                    <label>
                      意味・説明
                      <textarea
                        value={editMeaning}
                        onChange={(e) => setEditMeaning(e.target.value)}
                        rows={3}
                      />
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      style={{ width: "auto", fontSize: "0.75rem" }}
                      onClick={() => void handleUpdate(item.id)}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className={styles.btnOutline}
                      style={{ width: "auto", fontSize: "0.75rem" }}
                      onClick={() => setEditingId(null)}
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <strong style={{ fontSize: "0.9rem" }}>{item.term}</strong>
                      {item.reading && (
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>({item.reading})</span>
                      )}
                      {item.category && (
                        <span
                          style={{
                            fontSize: "0.7rem",
                            backgroundColor: "var(--border)",
                            padding: "1px 6px",
                            borderRadius: 4,
                            color: "var(--text-muted)",
                          }}
                        >
                          {item.category}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--fg)" }}>{item.meaning}</p>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      className={styles.btnOutline}
                      style={{ width: "auto", padding: "2px 8px", fontSize: "0.75rem" }}
                      onClick={() => {
                        setEditingId(item.id);
                        setEditTerm(item.term);
                        setEditMeaning(item.meaning);
                      }}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      className={styles.btnOutline}
                      style={{ width: "auto", padding: "2px 8px", fontSize: "0.75rem", color: "var(--danger, #dc2626)" }}
                      onClick={() => void handleDelete(item.id)}
                    >
                      削除
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

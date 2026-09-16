"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import type { ObservationDumpView } from "@/lib/observation-dump-types";
import type { FetchWithNameConfirm } from "./observation-dump-display";
import { JournalNameCandidateSuggestion } from "@/components/JournalNameCandidateSuggestion";

type Props = {
  selected: ObservationDumpView;
  fetchWithNameConfirm: FetchWithNameConfirm;
  reload: () => Promise<void>;
  onAccepted?: () => void;
  onDiscarded?: () => void;
};

export function ObservationDumpDetailPanel({ selected, fetchWithNameConfirm, reload, onAccepted, onDiscarded }: Props) {
  const [selectedChunkIds, setSelectedChunkIds] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [editingChunkId, setEditingChunkId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editDate, setEditDate] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seenChunkSyncKey, setSeenChunkSyncKey] = useState<string | null>(null);
  // docs/memo.md「テキストから検出されたメンバー名を確実に『人物』にすべて登録する」対応。
  // 採用直後だけの一度きりのヒント（他の入力経路と同じJournalNameCandidateSuggestionを流用）。
  const [nameCandidateHints, setNameCandidateHints] = useState<
    { entryId: string; people: string[]; candidates: string[] }[]
  >([]);

  // Dump選択や更新に合わせて、未採用チャンクを既定選択にする（ユーザーが後からトグル可能）
  const chunkSyncKey = `${selected.id}:${selected.updatedAt}`;
  if (chunkSyncKey !== seenChunkSyncKey) {
    setSeenChunkSyncKey(chunkSyncKey);
    const pending = selected.chunkDrafts
      .filter((c) => !c.acceptedJournalId && c.disposition !== "drop")
      .map((c) => c.id);
    setSelectedChunkIds(new Set(pending));
  }

  const selectedId = selected.id;

  async function handleReparse() {
    if (reparsing) return;
    setReparsing(true);
    setError(null);
    try {
      const res = await fetch(`/api/journal/dumps/${selectedId}/parse`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "再分割に失敗しました");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReparsing(false);
    }
  }

  async function handleDiscard() {
    const res = await fetch(`/api/journal/dumps/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discard: true }),
    });
    if (res.ok) {
      await reload();
      onDiscarded?.();
    }
  }

  async function toggleDrop(chunkId: string, drop: boolean) {
    await fetch(`/api/journal/dumps/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chunks: [{ id: chunkId, disposition: drop ? "drop" : "pending" }],
      }),
    });
    await reload();
  }

  function startEditChunk(chunk: { id: string; text: string; suggestedOccurredAt?: string }) {
    setEditingChunkId(chunk.id);
    setEditText(chunk.text);
    setEditDate(chunk.suggestedOccurredAt ?? "");
  }

  async function saveEditChunk() {
    if (!editingChunkId || savingEdit) return;
    const trimmed = editText.trim();
    if (!trimmed) {
      setError("チャンク本文を空にはできません");
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/journal/dumps/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chunks: [
            {
              id: editingChunkId,
              text: trimmed,
              suggestedOccurredAt: editDate.trim() ? editDate.trim() : null,
              disposition: "edit",
            },
          ],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "保存に失敗しました");
      setEditingChunkId(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleAccept() {
    if (selectedChunkIds.size === 0 || accepting) return;
    setAccepting(true);
    setError(null);
    setNameCandidateHints([]);
    try {
      const { res, data } = await fetchWithNameConfirm(
        `/api/journal/dumps/${selectedId}/accept`,
        {
          method: "POST",
          body: { chunkIds: [...selectedChunkIds] },
        },
        "チャンクをJournalにする",
      );
      if (!res.ok) {
        throw new Error((data as { error?: string })?.error || "採用に失敗しました");
      }
      const hints = (data as { nameCandidateSuggestions?: { entryId: string; people: string[]; candidates: string[] }[] })
        .nameCandidateSuggestions;
      if (hints && hints.length > 0) setNameCandidateHints(hints);
      await reload();
      onAccepted?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAccepting(false);
    }
  }

  function toggleChunk(id: string) {
    setSelectedChunkIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: "0.875rem", flex: 1 }}>
          プレビュー: {selected.title || "（無題）"}
        </h3>
        {selected.parseSource && (
          <span className={styles.subtitle}>分割: {selected.parseSource}</span>
        )}
        <button
          type="button"
          className={styles.btnOutline}
          onClick={handleReparse}
          disabled={reparsing || selected.status === "parsing"}
        >
          {reparsing ? "再分割中…" : "再分割"}
        </button>
        <button type="button" className={styles.btnOutline} onClick={handleDiscard}>
          破棄
        </button>
      </div>
      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}
      {selected.parseError && (
        <p className={styles.errorText} role="alert">
          {selected.parseError}
        </p>
      )}
      {selected.droppedNotes.length > 0 && (
        <p className={styles.subtitle} style={{ marginTop: 6 }}>
          除外メモ: {selected.droppedNotes.join(" / ")}
        </p>
      )}

      {selected.chunkDrafts.length === 0 ? (
        <p className={styles.subtitle} style={{ marginTop: 8 }}>
          {selected.status === "parsing" ? "分割中…" : "チャンクがありません。再分割を試してください。"}
        </p>
      ) : (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {selected.chunkDrafts.map((c) => {
            const disabled = !!c.acceptedJournalId || c.disposition === "drop";
            const isEditing = editingChunkId === c.id;
            return (
              <div
                key={c.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "8px 10px",
                  opacity: c.disposition === "drop" ? 0.55 : 1,
                  background: c.acceptedJournalId ? "var(--surface-muted, transparent)" : undefined,
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={selectedChunkIds.has(c.id)}
                    disabled={disabled || isEditing}
                    onChange={() => toggleChunk(c.id)}
                    style={{ marginTop: 4 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isEditing ? (
                      <>
                        <textarea
                          rows={4}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          style={{
                            width: "100%",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            padding: "6px 8px",
                            fontSize: "0.875rem",
                            fontFamily: "inherit",
                            resize: "vertical",
                          }}
                        />
                        <label
                          className={styles.subtitle}
                          style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}
                        >
                          日付案:
                          <input
                            type="date"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                          />
                        </label>
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <button
                            type="button"
                            className={styles.primaryBtn}
                            style={{ width: "auto" }}
                            disabled={savingEdit || !editText.trim()}
                            onClick={saveEditChunk}
                          >
                            {savingEdit ? "保存中…" : "保存"}
                          </button>
                          <button
                            type="button"
                            className={styles.btnOutline}
                            onClick={() => setEditingChunkId(null)}
                            disabled={savingEdit}
                          >
                            キャンセル
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ whiteSpace: "pre-wrap", fontSize: "0.875rem" }}>{c.text}</div>
                        <div className={styles.subtitle} style={{ marginTop: 4 }}>
                          {c.suggestedOccurredAt ? `日付案: ${c.suggestedOccurredAt} · ` : ""}
                          confidence: {c.confidence.toFixed(2)}
                          {c.people.length > 0 ? ` · ${c.people.join(", ")}` : ""}
                          {c.acceptedJournalId ? " · ✅ Journal化済み" : ""}
                          {c.disposition === "drop" ? " · 除外" : ""}
                          {c.disposition === "edit" ? " · 編集済" : ""}
                        </div>
                      </>
                    )}
                  </div>
                  {!c.acceptedJournalId && !isEditing && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {c.disposition !== "drop" && (
                        <button
                          type="button"
                          className={styles.btnOutline}
                          onClick={() => startEditChunk(c)}
                        >
                          編集
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.btnOutline}
                        onClick={() => toggleDrop(c.id, c.disposition !== "drop")}
                      >
                        {c.disposition === "drop" ? "戻す" : "除外"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className={styles.primaryBtn}
            style={{ width: "auto", alignSelf: "flex-start" }}
            disabled={selectedChunkIds.size === 0 || accepting}
            onClick={handleAccept}
          >
            {accepting
              ? "Journal化中…"
              : `選択した ${selectedChunkIds.size} 件を Journal にする`}
          </button>
          {nameCandidateHints.map((hint) => (
            <JournalNameCandidateSuggestion
              key={hint.entryId}
              entryId={hint.entryId}
              people={hint.people}
              candidates={hint.candidates}
            />
          ))}
        </div>
      )}
    </div>
  );
}

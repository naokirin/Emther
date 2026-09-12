"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import type { ObservationDumpView } from "@/lib/observation-dump-types";

const SOURCE_OPTIONS = [
  { value: "chat_log", label: "チャットログ（Slack等）" },
  { value: "meeting_log", label: "MTGログ（議事・文字起こし）" },
  { value: "other_log", label: "その他ログ" },
];

const STATUS_LABEL: Record<string, string> = {
  received: "受信済み",
  parsing: "分割中…",
  draft_ready: "提案あり",
  partially_accepted: "一部採用",
  done: "完了",
  discarded: "破棄",
  failed: "失敗",
};

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type Props = {
  onAccepted?: () => void;
};

export function ObservationDumpSection({ onAccepted }: Props) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [open, setOpen] = useState(false);
  const [dumps, setDumps] = useState<ObservationDumpView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [sourceType, setSourceType] = useState("chat_log");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedChunkIds, setSelectedChunkIds] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState(false);
  const [reparsing, setReparsing] = useState(false);

  const selected = dumps.find((d) => d.id === selectedId) ?? null;

  const reload = useCallback(async () => {
    const res = await fetch("/api/journal/dumps");
    const data = await res.json().catch(() => null);
    if (res.ok && data?.dumps) {
      setDumps(data.dumps as ObservationDumpView[]);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (open && !loaded) void reload();
  }, [open, loaded, reload]);

  useEffect(() => {
    if (!selected) {
      setSelectedChunkIds(new Set());
      return;
    }
    const pending = selected.chunkDrafts
      .filter((c) => !c.acceptedJournalId && c.disposition !== "drop")
      .map((c) => c.id);
    setSelectedChunkIds(new Set(pending));
  }, [selectedId, selected?.updatedAt]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        "/api/journal/dumps",
        {
          method: "POST",
          body: {
            sourceType,
            text,
            ...(title.trim() ? { title: title.trim() } : {}),
            ...(rangeStart || rangeEnd
              ? {
                  occurredRangeHint: {
                    ...(rangeStart ? { start: rangeStart } : {}),
                    ...(rangeEnd ? { end: rangeEnd } : {}),
                  },
                }
              : {}),
          },
        },
        "観測ログを取り込む",
      );
      if (!res.ok) {
        throw new Error((data as { error?: string })?.error || "取り込みに失敗しました");
      }
      const dump = (data as { dump: ObservationDumpView }).dump;
      setText("");
      setTitle("");
      setRangeStart("");
      setRangeEnd("");
      await reload();
      setSelectedId(dump.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReparse() {
    if (!selectedId || reparsing) return;
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
    if (!selectedId) return;
    const res = await fetch(`/api/journal/dumps/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discard: true }),
    });
    if (res.ok) {
      setSelectedId(null);
      await reload();
    }
  }

  async function toggleDrop(chunkId: string, drop: boolean) {
    if (!selectedId) return;
    await fetch(`/api/journal/dumps/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chunks: [{ id: chunkId, disposition: drop ? "drop" : "pending" }],
      }),
    });
    await reload();
  }

  async function handleAccept() {
    if (!selectedId || selectedChunkIds.size === 0 || accepting) return;
    setAccepting(true);
    setError(null);
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

  const activeDumps = dumps.filter((d) => d.status !== "discarded");

  return (
    <div className={styles.panel} style={{ marginBottom: 16 }}>
      <button
        type="button"
        className={`${styles.detailToggle} ${styles.detailToggleButton}`}
        onClick={() => setOpen(!open)}
      >
        📥 観測を取り込む（チャット / MTG / その他） {open ? "▲" : "▼"}
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          <p className={styles.subtitle} style={{ marginBottom: 10 }}>
            長いログを貼り付け、種別ごとに AI が原文抜粋の事実かたまりへ分割します。採用した分だけ通常の
            Journal になります（Issue 化はしません）。クラウドにはマスク後の本文のみ送ります。
          </p>

          <form onSubmit={handleCreate}>
            <div className={styles.field}>
              <label>
                ログの種類
                <Select
                  value={sourceType}
                  onChange={setSourceType}
                  options={SOURCE_OPTIONS}
                  style={{ minWidth: 220 }}
                />
              </label>
            </div>
            <div className={styles.field}>
              <label>
                タイトル（任意）
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: 9/10 週次 / #team-foo スレッド"
                />
              </label>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
              <label style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                期間ヒント（任意）:
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  style={{ marginLeft: 6 }}
                />
                {" 〜 "}
                <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
              </label>
            </div>
            <textarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                sourceType === "meeting_log"
                  ? "議事メモや文字起こしを貼り付け…"
                  : sourceType === "chat_log"
                    ? "Slack等の会話ログを貼り付け…"
                    : "観測テキストを貼り付け…"
              }
              style={{
                width: "100%",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 10px",
                fontSize: "0.8125rem",
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
            <button
              className={styles.primaryBtn}
              style={{ width: "auto", marginTop: 8 }}
              type="submit"
              disabled={!text.trim() || submitting}
            >
              {submitting ? "取り込み・分割中…" : "取り込んで分割する"}
            </button>
          </form>

          {error && (
            <p className={styles.errorText} role="alert" style={{ marginTop: 8 }}>
              {error}
            </p>
          )}

          <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "0.875rem" }}>取り込み一覧</h3>
            {!loaded ? (
              <p className={styles.subtitle}>読み込み中…</p>
            ) : activeDumps.length === 0 ? (
              <p className={styles.subtitle}>まだ取り込みはありません。</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {activeDumps.map((d) => (
                  <li key={d.id} style={{ marginBottom: 6 }}>
                    <button
                      type="button"
                      className={styles.btnOutline}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        borderColor: d.id === selectedId ? "var(--accent, var(--border))" : undefined,
                      }}
                      onClick={() => setSelectedId(d.id)}
                    >
                      <strong>{d.title || "（無題）"}</strong>
                      <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                        {SOURCE_OPTIONS.find((o) => o.value === d.sourceType)?.label ?? d.sourceType}
                        {" · "}
                        {STATUS_LABEL[d.status] ?? d.status}
                        {" · "}
                        {formatWhen(d.createdAt)}
                        {d.chunkDrafts.length > 0
                          ? ` · ${d.chunkDrafts.filter((c) => !c.acceptedJournalId && c.disposition !== "drop").length}件未採用`
                          : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected && (
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
                            disabled={disabled}
                            onChange={() => toggleChunk(c.id)}
                            style={{ marginTop: 4 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ whiteSpace: "pre-wrap", fontSize: "0.8125rem" }}>{c.text}</div>
                            <div className={styles.subtitle} style={{ marginTop: 4 }}>
                              {c.suggestedOccurredAt ? `日付案: ${c.suggestedOccurredAt} · ` : ""}
                              confidence: {c.confidence.toFixed(2)}
                              {c.people.length > 0 ? ` · ${c.people.join(", ")}` : ""}
                              {c.acceptedJournalId ? " · ✅ Journal化済み" : ""}
                              {c.disposition === "drop" ? " · 除外" : ""}
                            </div>
                          </div>
                          {!c.acceptedJournalId && (
                            <button
                              type="button"
                              className={styles.btnOutline}
                              onClick={() => toggleDrop(c.id, c.disposition !== "drop")}
                            >
                              {c.disposition === "drop" ? "戻す" : "除外"}
                            </button>
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
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {nameCandidateDialog}
    </div>
  );
}

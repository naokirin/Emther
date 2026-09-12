"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import type { ObservationDumpView } from "@/lib/observation-dump-types";
import type {
  FieldMapping,
  ImportMappingConfig,
  ImportProfile,
  ImportSyntax,
  SemanticField,
  TsKind,
} from "@/lib/observation-dump-mapping-types";
import {
  IMPORT_SYNTAX_OPTIONS,
  SEMANTIC_FIELD_OPTIONS,
  TS_KIND_OPTIONS,
} from "@/lib/observation-dump-mapping-types";
import type { ImportPreview } from "@/lib/observation-dump-mapping-types";

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
  /** `/journal?dump=` から深いリンク。あればセクションを開き当該 Dump を選択する */
  focusDumpId?: string | null;
};

export function ObservationDumpSection({ onAccepted, focusDumpId }: Props) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [open, setOpen] = useState(!!focusDumpId);
  const [dumps, setDumps] = useState<ObservationDumpView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(focusDumpId ?? null);

  const [sourceType, setSourceType] = useState("chat_log");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [syntax, setSyntax] = useState<ImportSyntax | "auto">("auto");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>({});
  const [tsKind, setTsKind] = useState<TsKind>("auto");
  const [hasHeader, setHasHeader] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [profiles, setProfiles] = useState<ImportProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");

  const [selectedChunkIds, setSelectedChunkIds] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [editingChunkId, setEditingChunkId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editDate, setEditDate] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

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
    if (focusDumpId) {
      setOpen(true);
      setSelectedId(focusDumpId);
      void reload();
    }
  }, [focusDumpId, reload]);

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

  async function runPreview(opts?: {
    syntaxOverride?: ImportSyntax | "auto";
    hasHeaderOverride?: boolean;
  }) {
    if (!text.trim()) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const syn = opts?.syntaxOverride ?? syntax;
      const header = opts?.hasHeaderOverride ?? hasHeader;
      const res = await fetch("/api/journal/dumps/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          ...(syn !== "auto" ? { syntax: syn } : {}),
          ...(syn === "tsv" || syn === "csv" || syn === "auto"
            ? { hasHeader: header }
            : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "プレビューに失敗しました");
      const p = data.preview as ImportPreview;
      setPreview(p);
      setProfiles((data.profiles as ImportProfile[]) ?? []);
      setFieldMapping(p.suggestedMapping);
      setTsKind(p.suggestedTsKind);
      setHasHeader(p.hasHeader);
      if (syn === "auto") setSyntax(p.suggestedSyntax);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  function buildMappingPayload(): ImportMappingConfig | undefined {
    const syn = syntax === "auto" ? preview?.suggestedSyntax : syntax;
    if (!syn || syn === "plain") {
      return syn === "plain" ? { syntax: "plain", fieldMapping: {}, tsKind: "auto" } : undefined;
    }
    if (!preview || preview.columns.length === 0) return undefined;
    return {
      syntax: syn,
      fieldMapping,
      tsKind,
      ...(syn === "tsv" || syn === "csv" ? { hasHeader } : {}),
    };
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      let effectivePreview = preview;
      let effectiveMapping = fieldMapping;
      let effectiveTsKind = tsKind;
      let effectiveSyntax = syntax;
      let effectiveHasHeader = hasHeader;

      if (!effectivePreview) {
        const syn = syntax;
        const res = await fetch("/api/journal/dumps/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            ...(syn !== "auto" ? { syntax: syn } : {}),
            hasHeader,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "プレビューに失敗しました");
        const p = data.preview as ImportPreview;
        effectivePreview = p;
        effectiveMapping = p.suggestedMapping;
        effectiveTsKind = p.suggestedTsKind;
        effectiveHasHeader = p.hasHeader;
        if (syn === "auto") effectiveSyntax = p.suggestedSyntax;
        setPreview(p);
        setProfiles((data.profiles as ImportProfile[]) ?? []);
        setFieldMapping(p.suggestedMapping);
        setTsKind(p.suggestedTsKind);
        setHasHeader(p.hasHeader);
        if (syn === "auto") setSyntax(p.suggestedSyntax);

        if (p.suggestedSyntax !== "plain") {
          throw new Error(
            "構造化ログです。表示された列対応を確認・調整し、もう一度「取り込んで分割する」を押してください",
          );
        }
      }

      const synResolved: ImportSyntax =
        effectiveSyntax === "auto"
          ? (effectivePreview.suggestedSyntax ?? "plain")
          : effectiveSyntax;

      let mapping: ImportMappingConfig;
      if (synResolved === "plain") {
        mapping = { syntax: "plain", fieldMapping: {}, tsKind: "auto" };
      } else {
        if (!Object.values(effectiveMapping).includes("text")) {
          throw new Error("列対応で「本文 text」を1つ指定してください");
        }
        mapping = {
          syntax: synResolved,
          fieldMapping: effectiveMapping,
          tsKind: effectiveTsKind,
          ...(synResolved === "tsv" || synResolved === "csv"
            ? { hasHeader: effectiveHasHeader }
            : {}),
        };
      }

      const { res, data } = await fetchWithNameConfirm(
        "/api/journal/dumps",
        {
          method: "POST",
          body: {
            sourceType,
            text,
            mapping,
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
      setPreview(null);
      setFieldMapping({});
      setSyntax("auto");
      await reload();
      setSelectedId(dump.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveProfile() {
    const mapping = buildMappingPayload();
    if (!mapping || mapping.syntax === "plain") {
      setError("保存できる列対応がありません");
      return;
    }
    if (!profileName.trim()) {
      setError("プロファイル名を入力してください");
      return;
    }
    const res = await fetch("/api/journal/dumps/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: profileName.trim(), config: mapping }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "プロファイル保存に失敗しました");
      return;
    }
    setProfiles((prev) => [data.profile as ImportProfile, ...prev.filter((p) => p.id !== data.profile.id)]);
    setProfileName("");
    setSelectedProfileId(data.profile.id);
  }

  function applyProfile(id: string) {
    setSelectedProfileId(id);
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setSyntax(p.config.syntax);
    setFieldMapping(p.config.fieldMapping);
    setTsKind(p.config.tsKind);
    if (typeof p.config.hasHeader === "boolean") setHasHeader(p.config.hasHeader);
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

  function startEditChunk(chunk: { id: string; text: string; suggestedOccurredAt?: string }) {
    setEditingChunkId(chunk.id);
    setEditText(chunk.text);
    setEditDate(chunk.suggestedOccurredAt ?? "");
  }

  async function saveEditChunk() {
    if (!selectedId || !editingChunkId || savingEdit) return;
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
            長いログを貼り付け、「列を確認する」で構文と列→意味を指定してから取り込んでください。採用分だけ
            Journal になり、クラウドへはマスク後のみ送ります。
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
              onChange={(e) => {
                setText(e.target.value);
                setPreview(null);
              }}
              placeholder={
                sourceType === "meeting_log"
                  ? "議事メモや文字起こしを貼り付け…"
                  : sourceType === "chat_log"
                    ? "Slack JSONL / TSV / 会話テキストを貼り付け…"
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

            <div
              style={{
                marginTop: 10,
                padding: 10,
                border: "1px solid var(--border)",
                borderRadius: 6,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <label style={{ fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: 6 }}>
                  構文:
                  <Select
                    value={syntax}
                    onChange={(v) => setSyntax(v as ImportSyntax | "auto")}
                    options={[{ value: "auto", label: "自動判定" }, ...IMPORT_SYNTAX_OPTIONS]}
                    style={{ minWidth: 200 }}
                  />
                </label>
                <button
                  type="button"
                  className={styles.btnOutline}
                  disabled={!text.trim() || previewing}
                  onClick={() => runPreview()}
                >
                  {previewing ? "解析中…" : "列を確認する"}
                </button>
              </div>

              {profiles.length > 0 && (
                <label style={{ fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: 6 }}>
                  保存済みプロファイル:
                  <Select
                    value={selectedProfileId}
                    onChange={applyProfile}
                    options={[
                      { value: "", label: "（選択）" },
                      ...profiles.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                    style={{ minWidth: 180 }}
                  />
                </label>
              )}

              {preview && preview.suggestedSyntax !== "plain" && preview.columns.length > 0 && (
                <>
                  {(preview.suggestedSyntax === "tsv" ||
                    preview.suggestedSyntax === "csv" ||
                    syntax === "tsv" ||
                    syntax === "csv") && (
                    <label style={{ fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={hasHeader}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setHasHeader(next);
                          void runPreview({
                            syntaxOverride: syntax === "auto" ? preview.suggestedSyntax : syntax,
                            hasHeaderOverride: next,
                          });
                        }}
                      />
                      先頭行をヘッダとして使う
                    </label>
                  )}
                  <label style={{ fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: 6 }}>
                    日時の解釈:
                    <Select
                      value={tsKind}
                      onChange={(v) => setTsKind(v as TsKind)}
                      options={TS_KIND_OPTIONS}
                      style={{ minWidth: 200 }}
                    />
                  </label>
                  <div style={{ fontSize: "0.8125rem" }}>
                    <strong>列 → 意味</strong>
                    <span className={styles.subtitle}>（{preview.rowCount} 行検出）</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {preview.columns.map((col) => (
                      <div
                        key={col}
                        style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
                      >
                        <code style={{ minWidth: 120, fontSize: "0.75rem" }}>{col}</code>
                        <Select
                          value={fieldMapping[col] ?? "ignore"}
                          onChange={(v) =>
                            setFieldMapping((prev) => ({ ...prev, [col]: v as SemanticField }))
                          }
                          options={SEMANTIC_FIELD_OPTIONS}
                          style={{ minWidth: 160 }}
                        />
                        <span
                          className={styles.subtitle}
                          style={{
                            maxWidth: 280,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          例: {preview.sampleRows[0]?.[col] ?? ""}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="プロファイル名（例: slack-bookmarklet）"
                      style={{ flex: 1, minWidth: 160 }}
                    />
                    <button type="button" className={styles.btnOutline} onClick={handleSaveProfile}>
                      この対応を保存
                    </button>
                  </div>
                </>
              )}
            </div>

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
                                    fontSize: "0.8125rem",
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
                                <div style={{ whiteSpace: "pre-wrap", fontSize: "0.8125rem" }}>{c.text}</div>
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

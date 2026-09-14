"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
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
import { SOURCE_OPTIONS, type FetchWithNameConfirm } from "./observation-dump-display";

type Props = {
  fetchWithNameConfirm: FetchWithNameConfirm;
  reload: () => Promise<void>;
  onCreated: (dumpId: string) => void;
};

export function ObservationDumpCreateForm({ fetchWithNameConfirm, reload, onCreated }: Props) {
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
      onCreated(dump.id);
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

  return (
    <>
      <p className={styles.subtitle} style={{ marginBottom: 10 }} title="採用分だけ Journal になり、クラウドへはマスク後のみ送信">
        ログを貼り付け → 必要なら列を確認 → 取り込む
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
          <label style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
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
            fontSize: "0.875rem",
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
            <label style={{ fontSize: "0.875rem", display: "flex", alignItems: "center", gap: 6 }}>
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
            <label style={{ fontSize: "0.875rem", display: "flex", alignItems: "center", gap: 6 }}>
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
                <label style={{ fontSize: "0.875rem", display: "flex", alignItems: "center", gap: 6 }}>
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
              <label style={{ fontSize: "0.875rem", display: "flex", alignItems: "center", gap: 6 }}>
                日時の解釈:
                <Select
                  value={tsKind}
                  onChange={(v) => setTsKind(v as TsKind)}
                  options={TS_KIND_OPTIONS}
                  style={{ minWidth: 200 }}
                />
              </label>
              <div style={{ fontSize: "0.875rem" }}>
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
    </>
  );
}

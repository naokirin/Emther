"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
import { type ObjectiveImportDraft, type ObjectiveWithProgress } from "@/lib/types";

type Props = {
  teamOptions: { value: string; label: string }[];
  refreshObjectives: () => Promise<void>;
  onClose: () => void;
  onImported: (objective: ObjectiveWithProgress) => void;
};

// docs/usage_issues U18: テキスト一括取り込み。
export function ObjectiveImportPanel({ teamOptions, refreshObjectives, onClose, onImported }: Props) {
  const [importText, setImportText] = useState("");
  const [importTeamId, setImportTeamId] = useState("");
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importDrafts, setImportDrafts] = useState<ObjectiveImportDraft[] | null>(null);
  const [importSource, setImportSource] = useState<"cloud" | "heuristic" | null>(null);
  const [importParsing, setImportParsing] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  async function handleParseImport() {
    if (!importText.trim()) return;
    setImportParsing(true);
    setImportError(null);
    try {
      const res = await fetch("/api/org/objectives/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: importText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "構造化に失敗しました");
      const drafts = Array.isArray(data.objectives) ? (data.objectives as ObjectiveImportDraft[]) : [];
      if (drafts.length === 0) throw new Error("Objectiveを抽出できませんでした。文言を見直すか、手で追記してください。");
      setImportDrafts(drafts);
      setImportSource(data.source === "cloud" ? "cloud" : "heuristic");
    } catch (err) {
      setImportError((err as Error).message);
      setImportDrafts(null);
      setImportSource(null);
    } finally {
      setImportParsing(false);
    }
  }

  async function handleSaveImport() {
    if (!importDrafts || importDrafts.length === 0) return;
    if (importMode === "replace") {
      const scopeLabel = importTeamId
        ? teamOptions.find((t) => t.value === importTeamId)?.label ?? "選択チーム"
        : "組織全体";
      const ok = window.confirm(
        `${scopeLabel}の既存Objectiveをすべて削除してから取り込みます。よろしいですか？`,
      );
      if (!ok) return;
    }
    setImportSaving(true);
    setImportError(null);
    try {
      const res = await fetch("/api/org/objectives/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: importMode,
          teamId: importTeamId || undefined,
          objectives: importDrafts,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り込みに失敗しました");
      setImportText("");
      setImportDrafts(null);
      setImportSource(null);
      await refreshObjectives();
      onClose();
      const first = Array.isArray(data.objectives) ? data.objectives[0] : null;
      if (first) onImported({ ...first, progress: first.progress ?? [] });
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setImportSaving(false);
    }
  }

  function updateImportDraft(index: number, patch: Partial<ObjectiveImportDraft>) {
    setImportDrafts((prev) => {
      if (!prev) return prev;
      return prev.map((d, i) => (i === index ? { ...d, ...patch } : d));
    });
  }

  function updateImportKr(index: number, krIndex: number, title: string) {
    setImportDrafts((prev) => {
      if (!prev) return prev;
      return prev.map((d, i) => {
        if (i !== index) return d;
        const keyResults = [...d.keyResults];
        keyResults[krIndex] = title;
        return { ...d, keyResults };
      });
    });
  }

  function addImportKr(index: number) {
    setImportDrafts((prev) => {
      if (!prev) return prev;
      return prev.map((d, i) => (i === index ? { ...d, keyResults: [...d.keyResults, ""] } : d));
    });
  }

  function removeImportKr(index: number, krIndex: number) {
    setImportDrafts((prev) => {
      if (!prev) return prev;
      return prev.map((d, i) =>
        i === index ? { ...d, keyResults: d.keyResults.filter((_, j) => j !== krIndex) } : d,
      );
    });
  }

  function removeImportDraft(index: number) {
    setImportDrafts((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  return (
    <>
      <div className={styles.editorPath}>
        <button
          type="button"
          className={styles.btnOutline}
          onClick={() => {
            onClose();
            setImportError(null);
          }}
        >
          一覧に戻る
        </button>
      </div>
      <div className={styles.field}>
        <label>OKRテキスト
        <textarea
          rows={8}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={"例:\nObjective: プロダクトの信頼性を上げる\nメモ: インシデントが増えたため\n- 重大インシデントを半期で50%削減\n- デプロイ失敗率を1%未満に"}
        /></label>
      </div>
      <div className={styles.field}>
        <span className={styles.fieldCaption}>取り込み先（所属チーム）</span>
        <Select
          value={importTeamId}
          onChange={setImportTeamId}
          options={[{ value: "", label: "組織全体" }, ...teamOptions]}
          label="取り込み先"
          style={{ width: "100%" }}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.fieldCaption}>保存モード</span>
        <div style={{ display: "flex", gap: 12, fontSize: "0.875rem" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="radio"
              name="importMode"
              checked={importMode === "append"}
              onChange={() => setImportMode("append")}
            />
            追記（既存は残す）
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="radio"
              name="importMode"
              checked={importMode === "replace"}
              onChange={() => setImportMode("replace")}
            />
            差し替え（同一スコープの既存を削除）
          </label>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          onClick={handleParseImport}
          disabled={importParsing || !importText.trim()}
        >
          {importParsing ? "構造化中…" : "構造化する"}
        </button>
        <button
          type="button"
          className={styles.btnOutline}
          onClick={handleSaveImport}
          disabled={importSaving || !importDrafts || importDrafts.length === 0}
        >
          {importSaving ? "保存中…" : "この内容で保存"}
        </button>
      </div>
      {importSource && (
        <p className={styles.subtitle}>
          分解元: {importSource === "cloud" ? "外部AI（CLI）" : "ルールベース"}
        </p>
      )}
      {importError && <p className={styles.errorText} role="alert">{importError}</p>}
      {importDrafts && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
          {importDrafts.map((draft, index) => (
            <div key={index} className={styles.field} style={{ margin: 0, padding: 10, border: "1px solid var(--input-border)", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <span className={styles.fieldCaption}>Objective {index + 1}</span>
                <button type="button" className={styles.btnOutline} onClick={() => removeImportDraft(index)}>
                  このObjectiveを除く
                </button>
              </div>
              <label>タイトル
              <textarea
                rows={2}
                value={draft.title}
                onChange={(e) => updateImportDraft(index, { title: e.target.value })}
              /></label>
              <label style={{ marginTop: 8, display: "block" }}>メモ（任意）
              <textarea
                rows={2}
                value={draft.note ?? ""}
                onChange={(e) => updateImportDraft(index, { note: e.target.value })}
              /></label>
              <span className={styles.fieldCaption} style={{ marginTop: 8, display: "block" }}>Key Results</span>
              {draft.keyResults.map((kr, krIndex) => (
                <div key={krIndex} style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "flex-start" }}>
                  <textarea
                    rows={2}
                    value={kr}
                    onChange={(e) => updateImportKr(index, krIndex, e.target.value)}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button type="button" className={styles.btnOutline} onClick={() => removeImportKr(index, krIndex)}>
                    削除
                  </button>
                </div>
              ))}
              <button type="button" className={styles.btnOutline} style={{ marginTop: 8 }} onClick={() => addImportKr(index)}>
                KRを追加
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

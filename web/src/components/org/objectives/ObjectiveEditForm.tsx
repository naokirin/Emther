"use client";

import styles from "@/app/page.module.css";
import { Select } from "@/components/Select";
import type { ObjectiveWithProgress } from "@/lib/types";

type Props = {
  selectedObjective: ObjectiveWithProgress;
  editObjectiveTitle: string;
  editObjectiveNote: string;
  editObjectiveTeamId: string;
  objectiveSaving: boolean;
  objectiveEditError: string | null;
  teamOptions: { value: string; label: string }[];
  onChangeTitle: (value: string) => void;
  onChangeNote: (value: string) => void;
  onChangeTeamId: (value: string) => void;
  onSave: () => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
};

export function ObjectiveEditForm({
  selectedObjective,
  editObjectiveTitle,
  editObjectiveNote,
  editObjectiveTeamId,
  objectiveSaving,
  objectiveEditError,
  teamOptions,
  onChangeTitle,
  onChangeNote,
  onChangeTeamId,
  onSave,
  onRemove,
  onCancel,
}: Props) {
  const objectiveDirty =
    editObjectiveTitle !== selectedObjective.title ||
    editObjectiveNote !== (selectedObjective.note ?? "") ||
    editObjectiveTeamId !== (selectedObjective.teamId ?? "");

  return (
    <>
      <div className={styles.editorPath}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className={styles.btnOutline} onClick={onCancel}>
            一覧に戻る
          </button>
          <button
            className={styles.primaryBtn}
            style={{ width: "auto" }}
            onClick={onSave}
            disabled={objectiveSaving || !editObjectiveTitle.trim() || !objectiveDirty}
          >
            {objectiveSaving ? "保存中…" : objectiveDirty ? "保存" : "保存済み"}
          </button>
          <button className={styles.btnOutline} onClick={() => onRemove(selectedObjective.id)}>
            このObjectiveを削除
          </button>
        </div>
      </div>
      <p className={styles.subtitle}>
        KeyResultへ紐付けた提案（追っていない・アーカイブ済みのものを除く）の件数を表示します。提案は達成度を自動追跡する管理項目ではなく、AIが提案した判断材料です。
      </p>
      <div className={styles.field}>
        <label>Objective（目標）
        <textarea
          rows={3}
          value={editObjectiveTitle}
          onChange={(e) => onChangeTitle(e.target.value)}
        /></label>
      </div>
      <div className={styles.field}>
        <label>メモ（判断の理由などの補足）
        <textarea
          rows={3}
          value={editObjectiveNote}
          onChange={(e) => onChangeNote(e.target.value)}
          placeholder="この目標にした理由・前提・例外など"
        /></label>
      </div>
      <div className={styles.field}>
        <span className={styles.fieldCaption}>所属チーム（未指定＝組織全体の目標）</span>
        <Select
          value={editObjectiveTeamId}
          onChange={onChangeTeamId}
          options={[{ value: "", label: "組織全体" }, ...teamOptions]}
          label="所属チーム"
          style={{ width: "100%" }}
        />
      </div>
      {objectiveEditError && <p className={styles.errorText} role="alert">{objectiveEditError}</p>}
    </>
  );
}

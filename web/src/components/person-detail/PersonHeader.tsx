"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";
import { PersonScoreBadge } from "@/components/PersonScoreBadge";
import { PERSON_VITAL_LABEL, personVitalReason, personVitalStatus, type PersonProfile } from "@/lib/types";

export function PersonHeader({
  person,
  refreshPerson,
  refreshPeople,
  onDeleted,
}: {
  person: PersonProfile;
  refreshPerson: () => Promise<void> | void;
  refreshPeople: () => Promise<void> | void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [selfSaving, setSelfSaving] = useState(false);
  const [selfError, setSelfError] = useState<string | null>(null);

  // docs/em_human_story_and_ux.md P2-12対応。ローカルNERが自由記述中の一般語や
  // チーム名を人物として誤登録した場合の削除導線（フィルタでは防ぎきれない誤登録の
  // 「最後の安全弁」）。
  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/people/${person.id}`, { method: "DELETE" });
      onDeleted();
    } catch {
      setDeleting(false);
    }
  }

  async function handleRename() {
    const next = nameDraft.trim();
    if (!next || next === person.name) {
      setRenaming(false);
      setNameError(null);
      return;
    }
    setNameSaving(true);
    setNameError(null);
    try {
      const res = await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "名前の変更に失敗しました");
      setRenaming(false);
      await Promise.all([refreshPerson(), refreshPeople()]);
    } catch (err) {
      setNameError((err as Error).message);
    } finally {
      setNameSaving(false);
    }
  }

  // ユーザー要望「メンバーに自分自身を追加したいが区別できない」対応。
  // 既存人物を settings.selfPersonId に紐付ける／解除する。
  async function handleToggleSelf() {
    setSelfSaving(true);
    setSelfError(null);
    try {
      const res = await fetch("/api/settings/rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selfPersonId: person.isSelf ? null : person.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "自分の設定に失敗しました");
      await Promise.all([refreshPerson(), refreshPeople()]);
    } catch (err) {
      setSelfError((err as Error).message);
    } finally {
      setSelfSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
      <PersonScoreBadge trend={person.trend} factCount={person.factCount} hasConcerningIssue={person.hasConcerningIssue} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          {renaming ? (
            <div className={styles.field} style={{ flex: 1, margin: 0 }}>
              <label>
                表示名
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  autoFocus
                  disabled={nameSaving}
                />
              </label>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button
                  className={styles.primaryBtn}
                  style={{ width: "auto" }}
                  type="button"
                  disabled={nameSaving || !nameDraft.trim() || nameDraft.trim() === person.name}
                  onClick={handleRename}
                >
                  {nameSaving ? "保存中…" : "保存"}
                </button>
                <button className={styles.btnOutline} type="button" disabled={nameSaving} onClick={() => { setRenaming(false); setNameError(null); }}>
                  キャンセル
                </button>
              </div>
              {nameError && <p className={styles.errorText} role="alert" style={{ marginTop: 6 }}>{nameError}</p>}
            </div>
          ) : (
            <div>
              <h2 style={{ margin: 0 }}>
                {person.name}
                {person.isSelf && <span className={styles.tag} style={{ marginLeft: 8, verticalAlign: "middle" }}>自分</span>}
              </h2>
              <button
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                type="button"
                onClick={() => {
                  setNameDraft(person.name);
                  setNameError(null);
                  setRenaming(true);
                }}
              >
                名前を変更
              </button>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <button className={styles.btnOutline} onClick={handleToggleSelf} disabled={selfSaving}>
              {selfSaving ? "更新中…" : person.isSelf ? "自分の設定を解除" : "自分として設定"}
            </button>
            <button
              className={`${styles.btnOutline} ${styles.axisTooltip}`}
              onClick={handleDelete}
              disabled={deleting}
              data-tooltip="自由記述からの人物抽出（ローカルNER）が一般語やチーム名を人物として誤登録した場合に、この人物エントリを削除します。"
            >
              {deleting ? "削除中…" : "誤登録として削除"}
            </button>
          </div>
        </div>
        {selfError && <p className={styles.errorText} role="alert">{selfError}</p>}
        <p className={styles.subtitle}>
          {person.isSelf ? "自分（利用者本人）" : person.isDirectReport ? "部下" : "その他（自分が管理するチーム以外）"} ／
          {person.teamNames.length > 0 ? ` 所属: ${person.teamNames.join(", ")}` : " 所属チームなし"} ／ 直近Journal {person.factCount}件
        </p>
        <p className={styles.subtitle}>
          気にかけるべき度合い: <strong>{PERSON_VITAL_LABEL[personVitalStatus(person.trend, person.hasConcerningIssue)]}</strong>
          {" — "}
          {personVitalReason(person.trend, person.hasConcerningIssue)}
        </p>
        {person.hasConcerningIssue && (
          <p className={styles.subtitle}>
            確認のうえ対応不要と判断した場合は、下の「関連提案」一覧の該当行から「確認済み/対応不要とする」を押すとこの強調は消えます。
          </p>
        )}
        {person.isSelf && (
          <p className={styles.subtitle}>自分（部下一覧・1on1 Coverage 対象外）</p>
        )}
      </div>
    </div>
  );
}

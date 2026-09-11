"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { PersonScoreBadge } from "@/components/PersonScoreBadge";
import { MultiSelectAutocomplete, type MultiSelectOption } from "@/components/MultiSelectAutocomplete";
import { Select } from "@/components/Select";
import { TagInput } from "@/components/TagInput";
import { usePeople, usePersonEvaluationLogs, usePersonProfile, useTeams } from "@/lib/hooks";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import {
  PERSON_VITAL_LABEL,
  URGENCY_LABEL,
  charterFilledCount,
  personVitalStatus,
  teamDisplayName,
  type PersonEvaluationLog,
  type Team,
} from "@/lib/types";

// ユーザー要望「メンバーの詳細画面からチームを設定できるようにしたい」対応。従来は
// Organization Context画面でチームを選んでからメンバー一覧を編集する必要があったが、
// 人物視点でチーム所属をその場で切り替えられるようにする。既存のチーム編集API
// （PATCH /api/teams/:id、members配列を丸ごと置き換える）をそのまま使い、新規APIは追加しない。
//
// ユーザー指摘「チームが増えるとメンバー詳細にチーム名の選択肢が大量に並ぶ」対応。
// 全チームを常に並べるチップ切り替えではなく、入力して部分一致した候補だけを出す
// マルチセレクトオートコンプリート（選択済みはタグ表示・✕で解除）に変更する。
function TeamMembershipEditor({
  personName,
  teams,
  onChanged,
}: {
  personName: string;
  teams: Team[];
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const activeTeams = teams.filter((t) => !t.archived);
  const currentTeamIds = activeTeams.filter((t) => t.members.includes(personName)).map((t) => t.id);
  const options: MultiSelectOption[] = activeTeams.map((t) => ({
    value: t.id,
    label: `${teamDisplayName(t.name)}${t.managedByEm ? "" : "（管理外）"}`,
  }));

  async function handleChange(nextTeamIds: string[]) {
    const added = nextTeamIds.filter((id) => !currentTeamIds.includes(id));
    const removed = currentTeamIds.filter((id) => !nextTeamIds.includes(id));
    if (added.length === 0 && removed.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(
        [...added, ...removed].map((teamId) => {
          const team = activeTeams.find((t) => t.id === teamId)!;
          const nextMembers = added.includes(teamId)
            ? [...team.members, personName]
            : team.members.filter((m) => m !== personName);
          return fetch(`/api/teams/${teamId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ members: nextMembers }),
          });
        }),
      );
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  if (activeTeams.length === 0) {
    return (
      <p className={styles.subtitle}>登録されているチームがありません。「チーム・メンバー」タブの「チーム」でチームを作成してください。</p>
    );
  }

  return (
    <MultiSelectAutocomplete
      values={currentTeamIds}
      onChange={handleChange}
      options={options}
      placeholder="チーム名で検索…"
      label="所属チーム"
      disabled={saving}
    />
  );
}

// ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。別名を追加・
// 取り消しするたびに即座にPATCH /api/people/:idへ反映する（チーム所属エディタと
// 同じ「都度保存」パターン。このページに「保存」ボタンは無い）。
function AliasEditor({ personId, aliases, onChanged }: { personId: string; aliases: string[]; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, string>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <TagInput
        values={aliases}
        onAdd={(name) => patch({ addAlias: name })}
        onRemove={(name) => patch({ removeAlias: name })}
        placeholder="別の呼び方（表記揺れ）を入力"
        label="別名"
        disabled={saving}
      />
      {error && <p className={styles.errorText} role="alert">{error}</p>}
    </>
  );
}

// ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
// 統合すると、選んだ人物（重複側）の記録・チーム所属がすべてこの画面の人物へ移り、
// 重複側の名前は以後この人物の別名として認識される。
function MergeDuplicatePerson({ personId, personName, onMerged }: { personId: string; personName: string; onMerged: () => void }) {
  const { people } = usePeople();
  const [duplicateId, setDuplicateId] = useState("");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = people.filter((p) => p.id !== personId);
  const options = candidates.map((p) => ({ value: p.id, label: p.name }));

  async function handleMerge() {
    if (!duplicateId) return;
    setMerging(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${personId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "統合に失敗しました");
      setDuplicateId("");
      onMerged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMerging(false);
    }
  }

  if (candidates.length === 0) {
    return <p className={styles.subtitle}>統合できる他の人物がいません。</p>;
  }

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Select value={duplicateId} onChange={setDuplicateId} options={options} placeholder="重複している人物を選ぶ" label="統合元の人物" disabled={merging} />
        <button className={styles.btnOutline} onClick={handleMerge} disabled={merging || !duplicateId}>
          {merging ? "統合中…" : `${personName}へ統合する`}
        </button>
      </div>
      <p className={styles.subtitle} style={{ marginTop: 6 }}>
        選んだ人物の記録・チーム所属はすべて{personName}へ移り、選んだ人物のエントリは消えます（その名前は以後{personName}の別名として認識されます）。元に戻す操作はありません。
      </p>
      {error && <p className={styles.errorText} role="alert">{error}</p>}
    </>
  );
}

// docs/em_ui_ux_issue.md「一覧⇄詳細をサイドピークで」対応。中身をidベースの
// コンポーネントに切り出し、フルページ（people/[id]/page）と一覧側のSlideOverの
// 両方から同じロジック・JSXを使う。page.tsx から named export すると Next.js の
// 生成型チェックに弾かれるため、コンポーネントファイルへ分離している。
//
// docs/memo.md「J. Peopleを第一級ハブに」対応。人物軸でJournal fact・長期プロファイル
// （解釈）・チーム所属・関連Issueを横断して見せる詳細画面。新規の永続化エンティティは
// 持たず、既存ストアを@/lib/people-hub.tsで集約しているだけ。辿る入口に加え、
// この人物に紐づくJournalをその場で追加できる（作成時にpeopleへ本人を明示付与）。
function PersonJournalComposer({
  personName,
  onCreated,
}: {
  personName: string;
  onCreated: () => void;
}) {
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [text, setText] = useState("");
  const [occurredAtDate, setOccurredAtDate] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    setStatus(null);
    try {
      const { res, data } = await fetchWithNameConfirm(
        "/api/journal",
        {
          method: "POST",
          body: {
            text: trimmed,
            occurredAtDate: occurredAtDate || undefined,
            people: [personName],
          },
        },
        "保存する",
      );
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "記録に失敗しました");
      setText("");
      setOccurredAtDate("");
      setDateOpen(false);
      setStatus("記録しました（未確認）。タグ・緊急度はJournal一覧で校正できます。");
      onCreated();
    } catch (err) {
      if ((err as Error).message === "人名候補の確認をキャンセルしました") return;
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} style={{ marginBottom: 12 }}>
        <p className={styles.subtitle} style={{ marginBottom: 6 }}>
          {personName}に紐づくJournalとして記録します。本文に名前が無くても、この人物へ紐付きます。
        </p>
        <div className={styles.journalInputRow}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={`例: ${personName}との1on1で、進捗の遅れへの不安を聞いた…`}
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
          />
          <button className={styles.primaryBtn} style={{ width: "auto" }} type="submit" disabled={pending || !text.trim()}>
            {pending ? "記録中…" : "Submit"}
          </button>
        </div>
        {dateOpen ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
              発生日
              <input
                type="date"
                value={occurredAtDate}
                onChange={(e) => setOccurredAtDate(e.target.value)}
                style={{ maxWidth: 160 }}
                disabled={pending}
              />
            </label>
            <button
              type="button"
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              disabled={pending}
              onClick={() => {
                setOccurredAtDate("");
                setDateOpen(false);
              }}
            >
              今日に戻す
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`${styles.detailToggle} ${styles.detailToggleButton}`}
            style={{ marginTop: 6 }}
            disabled={pending}
            onClick={() => setDateOpen(true)}
          >
            📅 今日の話じゃない（発生日を変える）
          </button>
        )}
        {error && (
          <p className={styles.errorText} role="alert" style={{ marginTop: 6 }}>
            {error}
          </p>
        )}
        {status && (
          <p className={styles.subtitle} style={{ marginTop: 6 }} role="status">
            ✅ {status}
          </p>
        )}
      </form>
      {nameCandidateDialog}
    </>
  );
}

export function PersonDetailContent({ id }: { id: string }) {
  const { person, personLoaded, refreshPerson } = usePersonProfile(id);
  const { evaluationLogs, evaluationLogsLoaded, refreshEvaluationLogs } = usePersonEvaluationLogs(id);
  const { refreshPeople } = usePeople();
  const { teams, refreshTeams } = useTeams();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [selfSaving, setSelfSaving] = useState(false);
  const [selfError, setSelfError] = useState<string | null>(null);
  const [evalSuggestBusy, setEvalSuggestBusy] = useState(false);
  const [evalBusyId, setEvalBusyId] = useState<string | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalMessage, setEvalMessage] = useState<string | null>(null);
  const [showPeriodBundle, setShowPeriodBundle] = useState(false);

  // チーム所属を変えるとisDirectReport・teamNamesも変わるため、両方のポーリング先を
  // 更新して画面上の表示（部下/その他ラベル・所属チーム名の一覧）をすぐ反映させる。
  async function handleTeamsChanged() {
    await Promise.all([refreshTeams(), refreshPerson()]);
  }

  async function handleSuggestEvaluationLogs() {
    if (!person) return;
    setEvalSuggestBusy(true);
    setEvalError(null);
    setEvalMessage(null);
    try {
      const res = await fetch(`/api/people/${person.id}/evaluation-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest-from-journal" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "仮置きに失敗しました");
      const n = Array.isArray(data.logs) ? data.logs.length : 0;
      setEvalMessage(n > 0 ? `${n}件の仮置きログを追加しました` : "新規の仮置きはありません（既存または材料不足）");
      await refreshEvaluationLogs();
    } catch (err) {
      setEvalError((err as Error).message);
    } finally {
      setEvalSuggestBusy(false);
    }
  }

  async function handleEvalStatus(logId: string, status: "confirmed" | "discarded" | "provisional") {
    setEvalBusyId(logId);
    setEvalError(null);
    try {
      const res = await fetch(`/api/people/${id}/evaluation-logs/${logId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "更新に失敗しました");
      }
      await refreshEvaluationLogs();
    } catch (err) {
      setEvalError((err as Error).message);
    } finally {
      setEvalBusyId(null);
    }
  }

  function renderEvalSection(title: string, logs: PersonEvaluationLog[]) {
    const visible = logs.filter((l) => l.status !== "discarded");
    return (
      <div style={{ marginBottom: 12 }}>
        <h4 style={{ margin: "0 0 6px", fontSize: "0.8125rem" }}>{title}</h4>
        {visible.length === 0 ? (
          <p className={styles.subtitle}>まだありません。</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {visible.map((log) => (
              <li
                key={log.id}
                style={{
                  border: "1px solid var(--input-border)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                  fontSize: "0.8125rem",
                }}
              >
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <span className={styles.tableMuted}>
                    {log.status === "provisional" ? "仮置き" : log.status === "confirmed" ? "確定" : log.status}
                  </span>
                  {log.polarity === "concern" && (
                    <span style={{ color: "var(--warning, #b45309)" }}>乖離・懸念</span>
                  )}
                  <span className={styles.tableMuted}>{new Date(log.createdAt).toLocaleDateString("ja-JP")}</span>
                </div>
                <p style={{ margin: "0 0 4px" }}>{log.snapshotText}</p>
                <p className={styles.subtitle} style={{ margin: "0 0 6px" }}>
                  {log.rationale}
                  {log.valueSnapshot ? ` / Values: ${log.valueSnapshot.slice(0, 80)}${log.valueSnapshot.length > 80 ? "…" : ""}` : ""}
                </p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Link href={`/journal?focus=${log.sourceJournalId}`} className={styles.detailToggle}>
                    根拠 Journal
                  </Link>
                  {log.status === "provisional" && (
                    <>
                      <button
                        type="button"
                        className={styles.btnOutline}
                        disabled={evalBusyId === log.id}
                        onClick={() => handleEvalStatus(log.id, "confirmed")}
                      >
                        確定
                      </button>
                      <button
                        type="button"
                        className={styles.btnOutline}
                        disabled={evalBusyId === log.id}
                        onClick={() => handleEvalStatus(log.id, "discarded")}
                      >
                        捨てる
                      </button>
                    </>
                  )}
                  {log.status === "confirmed" && (
                    <button
                      type="button"
                      className={styles.btnOutline}
                      disabled={evalBusyId === log.id}
                      onClick={() => handleEvalStatus(log.id, "provisional")}
                    >
                      仮置きに戻す
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // docs/em_human_story_and_ux.md P2-12対応。ローカルNERが自由記述中の一般語や
  // チーム名を人物として誤登録した場合の削除導線（フィルタでは防ぎきれない誤登録の
  // 「最後の安全弁」）。
  async function handleDelete() {
    if (!person) return;
    setDeleting(true);
    try {
      await fetch(`/api/people/${person.id}`, { method: "DELETE" });
      router.push("/people");
    } catch {
      setDeleting(false);
    }
  }

  async function handleRename() {
    if (!person) return;
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
    if (!person) return;
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

  if (!person) {
    return (
      <p className={styles.subtitle}>
        {!personLoaded ? "読み込み中…" : "該当する人物が見つかりませんでした。"}
      </p>
    );
  }

  return (
    <>
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
              <button className={styles.btnOutline} onClick={handleDelete} disabled={deleting} title="自由記述からの人物抽出（ローカルNER）が一般語やチーム名を人物として誤登録した場合に、この人物エントリを削除します。">
                {deleting ? "削除中…" : "誤登録として削除"}
              </button>
            </div>
          </div>
          {selfError && <p className={styles.errorText} role="alert">{selfError}</p>}
          <p className={styles.subtitle}>
            {person.isSelf ? "自分（利用者本人）" : person.isDirectReport ? "部下" : "その他（自分が管理するチーム以外）"} ／
            気にかけるべき度合い: {PERSON_VITAL_LABEL[personVitalStatus(person.trend, person.hasConcerningIssue)]} ／
            {person.teamNames.length > 0 ? ` 所属: ${person.teamNames.join(", ")}` : " 所属チームなし"} ／ 直近Journal {person.factCount}件
            {person.trend.positive > 0 && ` ／ 🙂${person.trend.positive}`}
            {person.trend.negative > 0 && ` ／ 🙁${person.trend.negative}`}
            {person.hasConcerningIssue && " ／ ⚠️ 停滞・ブロッカーありの関連Issueがあります"}
          </p>
          {person.isSelf && (
            <p className={styles.subtitle}>
              部下一覧・1on1 Coverageの対象外です。Agentへの組織コンテキストでは「利用者本人」と明示されます。
            </p>
          )}
        </div>
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>所属チーム</h3>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        チーム名の一部を入力すると候補が出ます。選ぶと所属に追加され、タグの✕で解除できます。「（管理外）」は自分が管理していないチーム（「チーム・メンバー」タブの「チーム」で設定）です。
      </p>
      <div style={{ marginBottom: 10 }}>
        <TeamMembershipEditor personName={person.name} teams={teams} onChanged={handleTeamsChanged} />
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>別名（表記揺れ）</h3>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        この人物の別の呼ばれ方（漢字表記・略称等）を登録しておくと、以後Journal等の自由記述にその別名が出てきても同じ人物として認識されます。
      </p>
      <div style={{ marginBottom: 10 }}>
        <AliasEditor personId={person.id} aliases={person.aliases} onChanged={refreshPerson} />
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>重複を統合</h3>
      <div style={{ marginBottom: 10 }}>
        <MergeDuplicatePerson personId={person.id} personName={person.name} onMerged={refreshPerson} />
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>日常の評価ログ（目標貢献 / Value）</h3>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        Journal の事実から仮置きします。テーマ / Issue は貢献の主経路にしません。単一スコアには潰さず、A（成果）と B（Value）を分けて読みます。朝のキューには載せません。
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button
          type="button"
          className={styles.primaryBtn}
          style={{ width: "auto" }}
          disabled={evalSuggestBusy}
          onClick={handleSuggestEvaluationLogs}
        >
          {evalSuggestBusy ? "仮置き中…" : "Journal から仮置きを提案"}
        </button>
        <button type="button" className={styles.btnOutline} onClick={() => setShowPeriodBundle((v) => !v)}>
          {showPeriodBundle ? "通常表示" : "期次の束ねを見る"}
        </button>
      </div>
      {evalError && (
        <p className={styles.errorText} role="alert">
          {evalError}
        </p>
      )}
      {evalMessage && <p className={styles.subtitle}>{evalMessage}</p>}
      {!evaluationLogsLoaded ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : showPeriodBundle ? (
        (() => {
          const outcome = evaluationLogs.filter((l) => l.lens === "outcome" && l.status !== "discarded");
          const value = evaluationLogs.filter((l) => l.lens === "value" && l.status !== "discarded");
          const missing: string[] = [];
          if (outcome.length === 0) missing.push("目標貢献ログが不足");
          if (value.length === 0) missing.push("Value 体現ログが不足");
          return (
            <div>
              {missing.length > 0 && (
                <p className={styles.subtitle} style={{ color: "var(--warning, #b45309)" }}>
                  不足: {missing.join(" / ")}
                </p>
              )}
              {renderEvalSection("A. 成果・目標貢献（束ね）", outcome)}
              {renderEvalSection("B. Value 適合（束ね）", value)}
            </div>
          );
        })()
      ) : (
        <div>
          {renderEvalSection(
            "A. 成果・目標貢献",
            evaluationLogs.filter((l) => l.lens === "outcome"),
          )}
          {renderEvalSection(
            "B. Value 適合",
            evaluationLogs.filter((l) => l.lens === "value"),
          )}
        </div>
      )}

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>長期プロファイル（解釈、TTLなし）</h3>
        {person.interpretations.length === 0 ? (
          <p className={styles.subtitle}>まだ記録がありません。Dashboardの長期プロファイルから記録できます。</p>
        ) : (
          <div className={styles.tableWrap} style={{ marginBottom: 10 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>内容</th>
                  <th>記録日時</th>
                </tr>
              </thead>
              <tbody>
                {person.interpretations.map((i) => (
                  <tr key={i.id}>
                    <td>{i.text}</td>
                    <td className={styles.tableMuted}>{new Date(i.occurredAt).toLocaleString("ja-JP")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>直近のJournal（一時的な状況、有効期限内のもののみ）</h3>
        <PersonJournalComposer personName={person.name} onCreated={refreshPerson} />
        {person.facts.length === 0 ? (
          <p className={styles.subtitle}>関連するJournalはまだありません。上のフォームから記録できます。</p>
        ) : (
          <div className={styles.tableWrap} style={{ marginBottom: 10 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>内容</th>
                  <th>タグ / 緊急度</th>
                  <th>発生日時</th>
                </tr>
              </thead>
              <tbody>
                {person.facts.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Link href={`/journal?focus=${f.id}`} className={styles.tableRowLink}>
                        {f.text}
                      </Link>
                    </td>
                    <td>
                      <div className={styles.tagRow}>
                        {f.tags.map((t) => (
                          <span key={t} className={`${styles.tag} ${styles.tagTopic}`}>
                            #{t}
                          </span>
                        ))}
                        {f.sentiment && f.sentiment !== "neutral" && (
                          <span className={`${styles.tag} ${f.sentiment === "positive" ? styles.tagPos : styles.tagNeg}`}>
                            #{f.sentiment === "positive" ? "ポジティブ" : "ネガティブ"}
                          </span>
                        )}
                        {f.urgency && (
                          <span className={`${styles.urgencyLabel} ${styles[`urgency${f.urgency}`]}`}>{URGENCY_LABEL[f.urgency]}</span>
                        )}
                      </div>
                    </td>
                    <td className={styles.tableMuted}>{new Date(f.occurredAt).toLocaleString("ja-JP")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.subtitle} style={{ marginTop: 4, marginBottom: 10 }}>
          <Link href={`/journal?person=${encodeURIComponent(person.name)}`} className={styles.tableRowLink}>
            {person.name}のJournalをすべて見る →
          </Link>
        </p>

        <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>関連Issue（EM介入。貢献評価の主経路ではない）</h3>
        <p className={styles.subtitle} style={{ marginBottom: 8 }}>
          Issue は EM の介入単位です。メンバー貢献の主材料にはしません（上の評価ログを正とします）。
        </p>
        <p className={styles.subtitle} style={{ marginBottom: 8 }}>
          名前がタイトル・Why/What/Howに含まれるIssueを表示しています（厳密な紐付けではなく名前の一致による簡易抽出です）。
        </p>
        {person.relatedIssues.length === 0 ? (
          <p className={styles.subtitle}>関連するIssueは見つかりませんでした。</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>タイトル</th>
                  <th>Why/What/How</th>
                </tr>
              </thead>
              <tbody>
                {person.relatedIssues.map((issue) => (
                  <tr key={issue.id}>
                    <td>
                      <Link href={`/issues/${issue.id}`} className={styles.tableRowLink}>
                        {issue.title}
                      </Link>
                      {issue.archived && <div className={styles.tableMuted}>🗄 アーカイブ済み</div>}
                    </td>
                    <td>
                      <span className={charterFilledCount(issue.charter) === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn}>
                        {charterFilledCount(issue.charter)}/3
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}

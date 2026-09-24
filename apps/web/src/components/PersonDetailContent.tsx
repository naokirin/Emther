import { useState } from "react";
import { useNavigate } from "@/router";
import styles from "../styles/page.module.css";
import { api, rpcInit, rpcData } from "../lib/api-client";
import { MultiSelectAutocomplete, type MultiSelectOption } from "./MultiSelectAutocomplete";
import { Select } from "./Select";
import { TagInput } from "./TagInput";
import { PersonHeader } from "./person-detail/PersonHeader";
import { PersonEvaluationLogsSection } from "./person-detail/PersonEvaluationLogsSection";
import { PersonRecordsSection } from "./person-detail/PersonRecordsSection";
import { usePeople, usePersonEvaluationLogs, usePersonProfile, useTeams } from "../lib/queries";
import { teamDisplayName, type Team } from "@emther/core/types";

// 従来は
// Organization Context画面でチームを選んでからメンバー一覧を編集する必要があったが
// 人物視点でチーム所属をその場で切り替えられるようにする。既存のチーム編集API
// （PATCH /api/teams/:id、members配列を丸ごと置き換える）をそのまま使い、新規APIは追加しない
// 全チームを常に並べるチップ切り替えではなく、入力して部分一致した候補だけを出す
// マルチセレクトオートコンプリート（選択済みはタグ表示・✕で解除）に変更する
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
          return api.api.teams[":id"].$patch(rpcInit({
            param: { id: teamId },
            json: { members: nextMembers },
          }));
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

// 別名を追加・
// 取り消しするたびに即座にPATCH /api/people/:idへ反映する（チーム所属エディタと
// 同じ「都度保存」パターン。このページに「保存」ボタンは無い）
function AliasEditor({ personId, aliases, onChanged }: { personId: string; aliases: string[]; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, string>) {
    setSaving(true);
    setError(null);
    try {
      const res = await api.api.people[":id"].$patch(rpcInit({
        param: { id: personId },
        json: body,
      }));
      const data = await rpcData<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "更新に失敗しました");
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

// 統合すると、選んだ人物（重複側）の記録・チーム所属がすべてこの画面の人物へ移り
// 重複側の名前は以後この人物の別名として認識される
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
      const res = await api.api.people[":id"].merge.$post(rpcInit({
        param: { id: personId },
        json: { duplicateId },
      }));
      const data = await rpcData<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "統合に失敗しました");
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

// フルページ（people/[id]）と一覧側のSlideOverの両方から同じロジック・JSXを使う。
// 人物軸でJournal fact・長期プロファイル（解釈）・チーム所属・関連提案を横断して見せる。
// 新規の永続化エンティティは持たず、既存ストアを集約しているだけ。
// この人物に紐づくJournalをその場で追加できる（作成時にpeopleへ本人を明示付与）。
export function PersonDetailContent({ id }: { id: string }) {
  const { person, personLoaded, refreshPerson } = usePersonProfile(id);
  const { evaluationLogs, evaluationLogsLoaded, refreshEvaluationLogs } = usePersonEvaluationLogs(id);
  const { refreshPeople } = usePeople();
  const { teams, refreshTeams } = useTeams();
  const navigate = useNavigate();

  // チーム所属を変えるとisDirectReport・teamNamesも変わるため、両方のポーリング先を
  // 更新して画面上の表示（部下/その他ラベル・所属チーム名の一覧）をすぐ反映させる。
  async function handleTeamsChanged() {
    await Promise.all([refreshTeams(), refreshPerson()]);
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
      <PersonHeader
        person={person}
        refreshPerson={refreshPerson}
        refreshPeople={refreshPeople}
        onDeleted={() => navigate("/people")}
      />

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}>所属チーム</h3>
      <div style={{ marginBottom: 10 }}>
        <TeamMembershipEditor personName={person.name} teams={teams} onChanged={handleTeamsChanged} />
      </div>

      <h3
        className={styles.axisTooltip}
        style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}
        data-tooltip="別名が出てきても同じ人物として認識"
        tabIndex={0}
      >
        別名（表記揺れ）
      </h3>
      <div style={{ marginBottom: 10 }}>
        <AliasEditor personId={person.id} aliases={person.aliases} onChanged={refreshPerson} />
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}>重複を統合</h3>
      <div style={{ marginBottom: 10 }}>
        <MergeDuplicatePerson personId={person.id} personName={person.name} onMerged={refreshPerson} />
      </div>

      <PersonEvaluationLogsSection
        personId={person.id}
        evaluationLogs={evaluationLogs}
        evaluationLogsLoaded={evaluationLogsLoaded}
        refreshEvaluationLogs={refreshEvaluationLogs}
      />

      <PersonRecordsSection
        person={person}
        onJournalCreated={refreshPerson}
        onProfileCreated={refreshPerson}
        onRecordChanged={refreshPerson}
      />
    </>
  );
}

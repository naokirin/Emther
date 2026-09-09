"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "@/app/page.module.css";
import { PersonScoreBadge } from "@/components/PersonScoreBadge";
import { usePersonProfile, useTeams } from "@/lib/hooks";
import { PERSON_VITAL_LABEL, URGENCY_LABEL, charterFilledCount, personVitalStatus, teamDisplayName, type Team } from "@/lib/types";

// ユーザー要望「メンバーの詳細画面からチームを設定できるようにしたい」対応。従来は
// Organization Context画面でチームを選んでからメンバー一覧を編集する必要があったが、
// 人物視点でチーム所属をその場で切り替えられるようにする。既存のチーム編集API
// （PATCH /api/teams/:id、members配列を丸ごと置き換える）をそのまま使い、新規APIは追加しない。
function TeamMembershipEditor({
  personName,
  teams,
  onChanged,
}: {
  personName: string;
  teams: Team[];
  onChanged: () => void;
}) {
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  const activeTeams = teams.filter((t) => !t.archived);

  async function toggleMembership(team: Team) {
    setPendingTeamId(team.id);
    const isMember = team.members.includes(personName);
    const nextMembers = isMember ? team.members.filter((m) => m !== personName) : [...team.members, personName];
    try {
      await fetch(`/api/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members: nextMembers }),
      });
      onChanged();
    } finally {
      setPendingTeamId(null);
    }
  }

  if (activeTeams.length === 0) {
    return (
      <p className={styles.subtitle}>登録されているチームがありません。Organization Contextでチームを作成してください。</p>
    );
  }

  return (
    <div role="group" aria-label="所属チーム" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {activeTeams.map((team) => {
        const isMember = team.members.includes(personName);
        return (
          <button
            key={team.id}
            type="button"
            className={`${styles.typeChip} ${isMember ? styles.typeChipSelected : ""}`}
            onClick={() => toggleMembership(team)}
            disabled={pendingTeamId === team.id}
            aria-pressed={isMember}
          >
            {isMember ? "✓ " : ""}
            {teamDisplayName(team.name)}
            {!team.managedByEm && "（管理外）"}
          </button>
        );
      })}
    </div>
  );
}

// docs/em_ui_ux_issue.md「一覧⇄詳細をサイドピークで」対応。中身をidベースの
// コンポーネントに切り出し、フルページ（本ファイル末尾のPersonDetailPage）と
// 一覧側のSlideOver（people/page.tsx）の両方から同じロジック・JSXを使う。
//
// docs/memo.md「J. Peopleを第一級ハブに」対応。人物軸でJournal fact・長期プロファイル
// （解釈）・チーム所属・関連Issueを横断して見せる詳細画面。新規の永続化エンティティは
// 持たず、既存ストアを@/lib/people-hub.tsで集約しているだけ（このページ自体はEMの
// 「介入」を行う場所ではなく、辿るための入口——実際の記録・起票は既存の各画面で行う）。
export function PersonDetailContent({ id }: { id: string }) {
  const { person, refreshPerson } = usePersonProfile(id);
  const { teams, refreshTeams } = useTeams();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  // チーム所属を変えるとisDirectReport・teamNamesも変わるため、両方のポーリング先を
  // 更新して画面上の表示（部下/その他ラベル・所属チーム名の一覧）をすぐ反映させる。
  async function handleTeamsChanged() {
    await Promise.all([refreshTeams(), refreshPerson()]);
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

  if (!person) {
    return <p className={styles.subtitle}>読み込み中、または該当する人物が見つかりませんでした。</p>;
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <PersonScoreBadge trend={person.trend} factCount={person.factCount} hasConcerningIssue={person.hasConcerningIssue} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <h2 style={{ margin: 0 }}>{person.name}</h2>
            <button className={styles.btnOutline} onClick={handleDelete} disabled={deleting} title="自由記述からの人物抽出（ローカルNER）が一般語やチーム名を人物として誤登録した場合に、この人物エントリを削除します。">
              {deleting ? "削除中…" : "誤登録として削除"}
            </button>
          </div>
          <p className={styles.subtitle}>
            {person.isDirectReport ? "部下" : "その他（自分が管理するチーム以外）"} ／
            気にかけるべき度合い: {PERSON_VITAL_LABEL[personVitalStatus(person.trend, person.hasConcerningIssue)]} ／
            {person.teamNames.length > 0 ? ` 所属: ${person.teamNames.join(", ")}` : " 所属チームなし"} ／ 直近Journal {person.factCount}件
            {person.trend.positive > 0 && ` ／ 🙂${person.trend.positive}`}
            {person.trend.negative > 0 && ` ／ 🙁${person.trend.negative}`}
            {person.hasConcerningIssue && " ／ ⚠️ 停滞・ブロッカーありの関連Issueがあります"}
          </p>
        </div>
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>所属チーム</h3>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        クリックで所属のON/OFFを切り替えられます。「（管理外）」は自分が管理していないチーム（Organization Contextで設定）です。
      </p>
      <div style={{ marginBottom: 10 }}>
        <TeamMembershipEditor personName={person.name} teams={teams} onChanged={handleTeamsChanged} />
      </div>

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
        {person.facts.length === 0 ? (
          <p className={styles.subtitle}>関連するJournalはありません。</p>
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

        <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>関連Issue</h3>
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

// フルページ表示用（直接URLアクセス・リロード・「詳細画面で開く」の遷移先）。
export default function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <Link href="/people" className={styles.subtitle}>
          ← People一覧に戻る
        </Link>
        <div style={{ marginTop: 8 }}>
          <PersonDetailContent id={id} />
        </div>
      </div>
    </div>
  );
}

"use client";

import { Suspense, useState } from "react";
import styles from "@/app/page.module.css";
import { PersonScoreBadge } from "@/components/PersonScoreBadge";
import { PersonDetailContent } from "@/components/PersonDetailContent";
import { SlideOver } from "@/components/SlideOver";
import { usePeekParam, usePeople } from "@/lib/hooks";
import { PERSON_VITAL_LABEL, personVitalStatus, type PersonSummary } from "@/lib/types";

// docs/memo.md「J. Peopleを第一級ハブに」対応。新規の永続化エンティティは持たず、
// 既存のJournal fact・解釈・チーム所属・関連Issueを人物軸で束ねて見せる一覧画面。
// 人物の登録は、この画面からの直接追加・チームメンバー登録・Journal校正・長期プロファイル
// 記録を通じて people-directory へ行われる（ローカルNERの検出結果では自動登録しない）。
//
// docs/em_ui_ux_issue.md「労務SaaS的な視覚スコア表示」「一覧⇄詳細をサイドピークで」対応。
// テーブルではなくスコアバッジ付きカードのグリッドにし、クリックでSlideOverを開く
// （usePeekParamはuseSearchParamsを使うため<Suspense>で包む必要がある）。
//
// ユーザー要望「メンバータブを『チーム・メンバー』とし、左メニューでチーム・メンバーを
// 切り替えられるようにしたい」対応。チーム管理は@/app/teams/page.tsxへ分離した
// （TopNav.tsxの「members」グループへ2画面目として追加し、既存のサイドメニュー機構に
// そのまま乗せている）。
export default function PeoplePage() {
  return (
    <Suspense fallback={null}>
      <PeoplePageInner />
    </Suspense>
  );
}

function PersonCardGrid({ people, onOpen }: { people: PersonSummary[]; onOpen: (id: string) => void }) {
  return (
    <div className={styles.personCardGrid}>
      {people.map((p) => (
        <button key={p.id} type="button" className={styles.personCard} onClick={() => onOpen(p.id)}>
          <PersonScoreBadge trend={p.trend} factCount={p.factCount} hasConcerningIssue={p.hasConcerningIssue} />
          <div className={styles.personCardBody}>
            <div className={styles.personCardName}>{p.name}</div>
            <div className={styles.tableMuted}>
              {PERSON_VITAL_LABEL[personVitalStatus(p.trend, p.hasConcerningIssue)]}・
              {p.teamNames.length > 0 ? p.teamNames.join(", ") : "未所属"}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function PeoplePageInner() {
  const { people, peopleLoaded, refreshPeople } = usePeople();
  const peek = usePeekParam("person");
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const sorted = [...people].sort((a, b) => b.factCount - a.factCount || a.name.localeCompare(b.name, "ja"));
  const reports = sorted.filter((p) => p.isDirectReport);
  const others = sorted.filter((p) => !p.isDirectReport);
  const peekedPerson = peek.id ? sorted.find((p) => p.id === peek.id) : undefined;

  async function handleAddPerson(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setSubmitting(true);
    setAddError(null);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "登録に失敗しました");
      setNewName("");
      await refreshPeople();
      if (typeof data?.person?.id === "string") peek.open(data.person.id);
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <h2>People</h2>
        <p className={styles.subtitle}>
          Quick Journal・チームメンバー登録・長期プロファイル・この画面からの直接追加を通じて認識された人物の一覧です。カードをクリックすると、その人物に関するJournal・長期プロファイル・関連Issueを横断して確認できます。
        </p>
        {/* ユーザー指摘「人のスコアを、どのくらい気をかけるべきかのバイタル表示にしたい」対応。
            円バッジはJournalの傾向から算出した「気にかけるべき度合い」を示す簡易バイタルで
            あり、点数ではないことと色の意味を明示する（Team Vitalsと同じ判定思想）。 */}
        <p className={styles.subtitle} style={{ marginBottom: 14 }}>
          円は本人に関するJournalの傾向・関連Issueの状況（停滞・ブロッカー）から算出した「気にかけるべき度合い」の簡易バイタルです（点数ではありません）。🟢安定　🟡やや注意　🔴要注意　⚪️評価不能（件数不足）
        </p>

        <form onSubmit={handleAddPerson} style={{ marginBottom: 16 }}>
          <div className={styles.field}>
            <label>
              人物を追加
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例: 田中さん"
                disabled={submitting}
              />
            </label>
          </div>
          <button className={styles.primaryBtn} type="submit" disabled={submitting || !newName.trim()}>
            {submitting ? "登録中…" : "追加"}
          </button>
          {addError && (
            <p className={styles.errorText} role="alert" style={{ marginTop: 8 }}>
              {addError}
            </p>
          )}
        </form>

        {sorted.length === 0 ? (
          <p className={styles.subtitle}>
            {!peopleLoaded
              ? "読み込み中…"
              : "まだ誰も登録されていません。上のフォームから追加するか、Quick Journalに記録するか、左メニューの「チーム」でメンバーを追加すると、ここに表示されます。"}
          </p>
        ) : (
          <>
            <h3 style={{ fontSize: "0.8125rem", marginBottom: 8 }}>部下（自分が管理するチームのメンバー）</h3>
            {reports.length === 0 ? (
              <p className={styles.subtitle} style={{ marginBottom: 16 }}>
                自分が管理するチームにメンバーが登録されていません。左メニューの「チーム」でチーム・メンバーを登録してください。
              </p>
            ) : (
              <div style={{ marginBottom: 20 }}>
                <PersonCardGrid people={reports} onOpen={peek.open} />
              </div>
            )}
            {others.length > 0 && (
              <>
                <h3 style={{ fontSize: "0.8125rem", marginBottom: 8 }}>その他</h3>
                <p className={styles.subtitle} style={{ marginBottom: 8 }}>
                  自分が管理するチーム以外で言及された人物です。1on1 Coverageの集計対象外です。
                </p>
                <PersonCardGrid people={others} onOpen={peek.open} />
              </>
            )}
          </>
        )}
      </div>

      {peekedPerson && (
        <SlideOver title={peekedPerson.name} detailHref={`/people/${peekedPerson.id}`} onClose={peek.close}>
          <PersonDetailContent id={peekedPerson.id} />
        </SlideOver>
      )}
    </div>
  );
}

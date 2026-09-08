"use client";

import { Suspense } from "react";
import styles from "@/app/page.module.css";
import { PersonScoreBadge } from "@/components/PersonScoreBadge";
import { PersonDetailContent } from "@/app/people/[id]/page";
import { SlideOver } from "@/components/SlideOver";
import { usePeekParam, usePeople } from "@/lib/hooks";

// docs/memo.md「J. Peopleを第一級ハブに」対応。新規の永続化エンティティは持たず、
// 既存のJournal fact・解釈・チーム所属・関連Issueを人物軸で束ねて見せるだけの一覧画面。
// 人物の「登録」自体はこの画面からは行わない（Journal記録・チームメンバー登録・長期プロファイル
// 記録の副産物としてpeople-directoryへ自動登録される既存の仕組みをそのまま使う）。
//
// docs/em_ui_ux_issue.md「労務SaaS的な視覚スコア表示」「一覧⇄詳細をサイドピークで」対応。
// テーブルではなくスコアバッジ付きカードのグリッドにし、クリックでSlideOverを開く
// （usePeekParamはuseSearchParamsを使うため<Suspense>で包む必要がある）。
export default function PeoplePage() {
  return (
    <Suspense fallback={null}>
      <PeoplePageInner />
    </Suspense>
  );
}

function PeoplePageInner() {
  const { people } = usePeople();
  const peek = usePeekParam("person");
  const sorted = [...people].sort((a, b) => b.factCount - a.factCount || a.name.localeCompare(b.name, "ja"));
  const peekedPerson = peek.id ? sorted.find((p) => p.id === peek.id) : undefined;

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <h2>People</h2>
        <p className={styles.subtitle} style={{ marginBottom: 14 }}>
          Quick Journal・チームメンバー登録・長期プロファイルを通じて認識された人物の一覧です。カードをクリックすると、その人物に関するJournal・長期プロファイル・関連Issueを横断して確認できます。
        </p>
        {sorted.length === 0 ? (
          <p className={styles.subtitle}>まだ誰も登録されていません。Quick Journalに記録するかチームにメンバーを追加すると、ここに表示されます。</p>
        ) : (
          <div className={styles.personCardGrid}>
            {sorted.map((p) => (
              <button key={p.id} type="button" className={styles.personCard} onClick={() => peek.open(p.id)}>
                <PersonScoreBadge trend={p.trend} factCount={p.factCount} />
                <div className={styles.personCardBody}>
                  <div className={styles.personCardName}>{p.name}</div>
                  <div className={styles.tableMuted}>{p.teamNames.length > 0 ? p.teamNames.join(", ") : "未所属"}</div>
                </div>
              </button>
            ))}
          </div>
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

"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { PageTitleRow } from "@/components/HelpLink";
import { StrategyThreadTree } from "@/components/org/StrategyThreadTree";
import { useIssues, useJournal, useObjectives } from "@/lib/hooks";

// docs/memo.md「Journal・Issue・方針目標・ふりかえりを行き来し続ける認知負荷」対応。
// 「方針・目標」タブの管理面（/org）は編集用途に絞ったまま肥大化させず、Objective→KR→
// Issue→Journalの縦の接続を一望する閲覧専用ビューをサイドタブとして分離する
// （既存の「振り返り」グループが/growth・/timeline・/reportsを束ねているのと同じパターン）。
export default function OrgThreadPage() {
  return (
    <Suspense fallback={null}>
      <OrgThreadPageInner />
    </Suspense>
  );
}

function OrgThreadPageInner() {
  const searchParams = useSearchParams();
  const focusObjectiveId = searchParams.get("objective");

  const { objectives, objectivesLoaded } = useObjectives();
  const { issues } = useIssues();
  const { journalEntries } = useJournal();

  return (
    <div className={styles.screen}>
      <PageTitleRow title="つながりを見る" helpAnchor="org" />
      <p className={styles.subtitle} style={{ marginTop: 8, marginBottom: 14 }}>
        方針・目標(Objective/Key Result)から、それを担う提案、その根拠となったJournalまでを辿れます。編集は「方針・目標」タブで行ってください。
      </p>
      <div className={styles.panel}>
        <StrategyThreadTree
          objectives={objectives}
          objectivesLoaded={objectivesLoaded}
          issues={issues}
          journalEntries={journalEntries}
          focusObjectiveId={focusObjectiveId}
        />
      </div>
    </div>
  );
}

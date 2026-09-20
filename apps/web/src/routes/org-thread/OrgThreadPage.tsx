import { useSearchParams } from "react-router";
import styles from "../../styles/page.module.css";
import { PageTitleRow } from "../../components/HelpLink";
import { StrategyThreadTree } from "../../components/org/StrategyThreadTree";
import { useIssues, useJournal, useObjectives } from "../../lib/queries";

// web/src/app/org/thread/page.tsx（Next.js版）からの移植（フェーズ3.5 tier3）。
// react-routerのuseSearchParamsはSuspenseを要求しないため、元実装の<Suspense>ラッパーは
// 不要（削除した）。
export function OrgThreadPage() {
  const [searchParams] = useSearchParams();
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

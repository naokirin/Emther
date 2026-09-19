"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { PageTitleRow } from "@/components/HelpLink";
import { buildTeamTree, TeamTreeView } from "@/components/teams/TeamTree";
import { TeamCreatePanel } from "@/components/teams/TeamCreatePanel";
import { TeamEditPanel } from "@/components/teams/TeamEditPanel";
import { useEntityHistory, useIssues, useJournal, useTeams } from "@/lib/hooks";
import type { Team } from "@core/types";

// ユーザー要望「メンバータブを『チーム・メンバー』とし、コンテンツをグループ内タブでチーム・
// メンバーと切り替えられるようにしてほしい」対応。TopNav.tsxの「members」グループへ
// 2画面目として追加し、AppShellのサブナビ機構（複数画面を持つグループで
// 自動的に出る）にそのまま乗せる。チーム管理のロジック自体はpeople/page.tsxから
// この専用ページへ移設しただけで変更していない。

export default function TeamsPage() {
  return (
    <Suspense fallback={null}>
      <TeamsPageInner />
    </Suspense>
  );
}

// Dashboardの「チームリスク」などから `?focus=<teamId>` で飛んできたとき、該当チームを
// 右パネルに開く（/journal?focus= と同じ導線）。useSearchParams を使うため Suspense で包む。
function TeamsPageInner() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");

  const { teams, teamsLoaded, refreshTeams } = useTeams();
  const { issues } = useIssues();
  const { journalEntries } = useJournal();

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [showArchivedTeams, setShowArchivedTeams] = useState(false);
  const [appliedFocusId, setAppliedFocusId] = useState<string | null>(null);

  const selectedTeam = selectedTeamId ? teams.find((t) => t.id === selectedTeamId) ?? null : null;
  const visibleTeams = teams.filter((t) => showArchivedTeams || !t.archived);
  const teamTree = buildTeamTree(visibleTeams);
  const { history: teamHistory } = useEntityHistory("team", selectedTeam?.id ?? null);

  function selectTeam(team: Team) {
    setSelectedTeamId(team.id);
    if (team.archived) setShowArchivedTeams(true);
  }

  // focusId は teams の初回ロード後に一度だけ適用する（ポーリングで編集中ドラフトを上書きしない）。
  if (teamsLoaded && focusId && focusId !== appliedFocusId) {
    setAppliedFocusId(focusId);
    const focused = teams.find((t) => t.id === focusId);
    if (focused) selectTeam(focused);
  }

  return (
    <div className={styles.screen}>
      <PageTitleRow title="チーム" helpAnchor="teams" />
      <div className={styles.layout}>
        <div className={styles.panel}>
          <TeamCreatePanel refreshTeams={refreshTeams} onCreated={selectTeam} />

        <div className={styles.tree} style={{ marginTop: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)", margin: "4px 0" }}>
            <input type="checkbox" checked={showArchivedTeams} onChange={(e) => setShowArchivedTeams(e.target.checked)} />
            アーカイブ済みも表示する
          </label>
          {visibleTeams.length === 0 && (
            <p className={styles.subtitle}>{!teamsLoaded ? "読み込み中…" : "まだチームが登録されていません。"}</p>
          )}
          <TeamTreeView nodes={teamTree} depth={0} selectedTeamId={selectedTeamId} onSelect={selectTeam} />
        </div>
      </div>

      <div className={styles.panel}>
        <TeamEditPanel
          selectedTeam={selectedTeam}
          issues={issues}
          journalEntries={journalEntries}
          teamHistory={teamHistory}
          refreshTeams={refreshTeams}
          onRemoved={() => setSelectedTeamId(null)}
        />
      </div>
      </div>
    </div>
  );
}

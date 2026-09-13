"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "@/app/page.module.css";
import { ObjectivesPanel } from "@/components/org/ObjectivesPanel";
import { OrgLeftTree, type Selection } from "@/components/org/OrgLeftTree";
import { OrgThemesPanel } from "@/components/org/OrgThemesPanel";
import { StandingBackgroundPanel } from "@/components/org/StandingBackgroundPanel";
import { StrategyPanel } from "@/components/org/StrategyPanel";
import { useObjectives, useOrgBackgrounds, useOrgStrategy, useTeams, useThemes } from "@/lib/hooks";
import { teamDisplayName, type OrgTheme } from "@/lib/types";

// ユーザー要望「方針・目標タブでは、方針・目標の設定によりフォーカスした形にしたい」対応。
// チーム管理（Teams）は@/app/teams/page.tsx（チーム・メンバータブ）へ移設した。ここはEMが
// Agent Runtimeへ「絶対の前提」として注入する組織の憲法（MVV＝Strategy）と、戦略→Issue→結果を
// つなぐOKR（Objectives）、Standing Background（長期の背景事実）、および期の焦点としての
// Themes（OrgTheme）に絞る。
// Strategy / Standing Background / Objectives / Themes はいずれも左ツリーは入口だけで、
// 追加・一覧・編集は右パネルの専用ビューで行う。
//
// ユーザー指摘「目標は組織内でカスケーディングされるもの（上位組織の目標達成のために
// 下位組織の目標がある）」対応。ObjectiveにteamId（未指定＝組織全体、指定時はそのチーム自身の
// 目標）を持たせ、既存のチーム階層（Team.nameの"/"区切り）にそのままネストして表示する。
// MVVも同様にチーム単位のMission/制約（Team.charter、編集はチーム・メンバータブ）を
// 組織MVVの下に読み取り専用で並べ、カスケーディングを一望できるようにする。

export default function OrgContextPage() {
  return (
    <Suspense fallback={null}>
      <OrgContextPageInner />
    </Suspense>
  );
}

// Issue詳細・一覧などから `?objective=<id>` で飛んできたとき、該当 Objective を右パネルで開く。
function OrgContextPageInner() {
  const searchParams = useSearchParams();
  const objectiveFocusId = searchParams.get("objective");

  const { strategy, strategyLoaded, refreshStrategy } = useOrgStrategy();
  const { backgrounds, backgroundsLoaded, refreshBackgrounds } = useOrgBackgrounds();
  const { objectives, objectivesLoaded, refreshObjectives } = useObjectives();
  const { teams, teamsLoaded } = useTeams();
  const { themes, themesLoaded, refreshThemes } = useThemes();
  const activeTeams = teams.filter((t) => !t.archived);
  const teamOptions = activeTeams.map((t) => ({ value: t.id, label: teamDisplayName(t.name) }));
  const adoptedThemes = themes.filter((t) => t.status === "adopted");

  const [selection, setSelection] = useState<Selection>(null);
  const [appliedObjectiveFocusId, setAppliedObjectiveFocusId] = useState<string | null>(null);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);

  // 各パネルは選択中(kind一致)のときだけマウントされ、内部stateはアンマウントで
  // 自然にリセットされる。ただし「同じツリー項目を選択中にもう一度クリックする」場合は
  // kindが変わらずマウントされ続けるため、navTokenをkeyに含めて強制的に再マウントし、
  // 元の実装（クリックのたびに一覧へ戻す）と同じ挙動にする。
  const [navToken, setNavToken] = useState(0);

  function selectStrategy() {
    setSelection({ kind: "strategy" });
    setNavToken((n) => n + 1);
  }

  function selectBackgroundsView() {
    setSelection({ kind: "backgrounds" });
    setNavToken((n) => n + 1);
  }

  function selectObjectivesView() {
    setSelection({ kind: "objectives" });
    setNavToken((n) => n + 1);
  }

  function selectThemesView() {
    setEditingThemeId(null);
    setSelection({ kind: "themes" });
  }

  function openTheme(theme: OrgTheme) {
    setEditingThemeId(theme.id);
    setSelection({ kind: "themes" });
  }

  // objectives の初回ロード後に一度だけ、URLの?objective=をobjectives一覧へ反映する
  // （ポーリングで編集中ドラフトを上書きしないよう、id単位でガードする）。
  if (
    objectivesLoaded &&
    objectiveFocusId &&
    objectiveFocusId !== appliedObjectiveFocusId &&
    objectives.some((o) => o.id === objectiveFocusId)
  ) {
    setAppliedObjectiveFocusId(objectiveFocusId);
    setSelection({ kind: "objectives" });
  }

  return (
    <div className={`${styles.layout} ${styles.screen}`}>
      <OrgLeftTree
        selection={selection}
        backgroundsLoaded={backgroundsLoaded}
        activeBackgroundsCount={backgrounds.filter((b) => b.status === "active").length}
        objectivesLoaded={objectivesLoaded}
        objectivesCount={objectives.length}
        themesLoaded={themesLoaded}
        adoptedThemesCount={adoptedThemes.length}
        onSelectStrategy={selectStrategy}
        onSelectBackgrounds={selectBackgroundsView}
        onSelectObjectives={selectObjectivesView}
        onSelectThemes={selectThemesView}
      />

      <div className={styles.panel}>
        {!selection && (
          <p className={styles.emptyState}>左のツリーからStrategy・Standing Background・Objectives・Themesを選択してください。</p>
        )}

        {selection?.kind === "strategy" && (
          <StrategyPanel
            key={navToken}
            strategy={strategy}
            strategyLoaded={strategyLoaded}
            refreshStrategy={refreshStrategy}
            activeTeams={activeTeams}
            teamsLoaded={teamsLoaded}
          />
        )}

        {selection?.kind === "backgrounds" && (
          <StandingBackgroundPanel
            key={navToken}
            backgrounds={backgrounds}
            backgroundsLoaded={backgroundsLoaded}
            refreshBackgrounds={refreshBackgrounds}
          />
        )}

        {selection?.kind === "objectives" && (
          <ObjectivesPanel
            key={navToken}
            objectives={objectives}
            objectivesLoaded={objectivesLoaded}
            refreshObjectives={refreshObjectives}
            activeTeams={activeTeams}
            teamOptions={teamOptions}
            themes={themes}
            refreshThemes={refreshThemes}
            focusObjectiveId={appliedObjectiveFocusId === objectiveFocusId ? objectiveFocusId : null}
            onOpenTheme={openTheme}
          />
        )}

        {selection?.kind === "themes" && (
          <OrgThemesPanel
            themes={themes}
            themesLoaded={themesLoaded}
            objectives={objectives}
            refreshThemes={refreshThemes}
            editingThemeId={editingThemeId}
            onSelectTheme={(theme) => setEditingThemeId(theme.id)}
            onBack={() => setEditingThemeId(null)}
          />
        )}
      </div>
    </div>
  );
}

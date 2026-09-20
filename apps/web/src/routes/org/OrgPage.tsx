import { useState } from "react";
import { useSearchParams } from "react-router";
import styles from "../../styles/page.module.css";
import { PageTitleRow } from "../../components/HelpLink";
import { ObjectivesPanel } from "../../components/org/ObjectivesPanel";
import { OrgLeftTree, type Selection } from "../../components/org/OrgLeftTree";
import { OrgThemesPanel } from "../../components/org/OrgThemesPanel";
import { GlossaryPanel } from "../../components/org/GlossaryPanel";
import { StandingBackgroundPanel } from "../../components/org/StandingBackgroundPanel";
import { StrategyPanel } from "../../components/org/StrategyPanel";
import { useObjectives, useOrgBackgrounds, useOrgStrategy, useTeams, useThemes } from "../../lib/queries";
import { teamDisplayName, type OrgTheme } from "@emther/core/types";

// web/src/app/org/page.tsx（Next.js版）からの移植（フェーズ3.5 tier3）。react-routerの
// useSearchParamsはSuspenseを要求しないため、元実装の<Suspense>ラッパーは不要（削除した）。
// Issue詳細・一覧などから `?objective=<id>` で飛んできたとき、該当 Objective を右パネルで開く。
export function OrgPage() {
  const [searchParams] = useSearchParams();
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

  function selectGlossaryView() {
    setSelection({ kind: "glossary" });
    setNavToken((n) => n + 1);
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
    <div className={styles.screen}>
      <PageTitleRow title="方針・目標" helpAnchor="org" />
      <div className={styles.layout}>
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
          onSelectGlossary={selectGlossaryView}
        />

        <div className={styles.panel}>
          {!selection && (
            <p className={styles.emptyState}>左のツリーからStrategy・Standing Background・Objectives・Themes・Glossaryを選択してください。</p>
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

          {selection?.kind === "glossary" && <GlossaryPanel key={navToken} />}
        </div>
      </div>
    </div>
  );
}

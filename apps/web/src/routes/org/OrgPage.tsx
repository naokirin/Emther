import { useState } from "react";
import styles from "../../styles/page.module.css";
import { PageTitleRow } from "../../components/HelpLink";
import { OrgLeftTree, type Selection } from "../../components/org/OrgLeftTree";
import { OrgThemesPanel } from "../../components/org/OrgThemesPanel";
import { GlossaryPanel } from "../../components/org/GlossaryPanel";
import { GoalsPanel } from "../../components/org/GoalsPanel";
import { PolicyPanel } from "../../components/org/PolicyPanel";
import { StandingBackgroundPanel } from "../../components/org/StandingBackgroundPanel";
import { StrategyPanel } from "../../components/org/StrategyPanel";
import { useGoals, useOrgBackgrounds, useOrgStrategy, usePolicies, useTeams, useThemes } from "../../lib/queries";
import { teamDisplayName } from "@emther/core/types";

// web/src/app/org/page.tsx（Next.js版）からの移植（フェーズ3.5 tier3）。
export function OrgPage() {
  const { strategy, strategyLoaded, refreshStrategy } = useOrgStrategy();
  const { backgrounds, backgroundsLoaded, refreshBackgrounds } = useOrgBackgrounds();
  const { policies, policiesLoaded, refreshPolicies } = usePolicies();
  const { goals, goalsLoaded, refreshGoals } = useGoals();
  const { teams, teamsLoaded } = useTeams();
  const { themes, themesLoaded, refreshThemes } = useThemes();
  const activeTeams = teams.filter((t) => !t.archived);
  const teamOptions = activeTeams.map((t) => ({ value: t.id, label: teamDisplayName(t.name) }));
  const adoptedThemes = themes.filter((t) => t.status === "adopted");

  const [selection, setSelection] = useState<Selection>(null);
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

  function selectPoliciesView() {
    setSelection({ kind: "policies" });
    setNavToken((n) => n + 1);
  }

  function selectGoalsView() {
    setSelection({ kind: "goals" });
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

  return (
    <div className={styles.screen}>
      <PageTitleRow title="方針・目標" helpAnchor="org" />
      <div className={styles.layout}>
        <OrgLeftTree
          selection={selection}
          backgroundsLoaded={backgroundsLoaded}
          activeBackgroundsCount={backgrounds.filter((b) => b.status === "active").length}
          policiesLoaded={policiesLoaded}
          activePoliciesCount={policies.filter((p) => !p.archivedAt).length}
          goalsLoaded={goalsLoaded}
          activeGoalsCount={goals.filter((g) => g.status === "active").length}
          themesLoaded={themesLoaded}
          adoptedThemesCount={adoptedThemes.length}
          onSelectStrategy={selectStrategy}
          onSelectBackgrounds={selectBackgroundsView}
          onSelectPolicies={selectPoliciesView}
          onSelectGoals={selectGoalsView}
          onSelectThemes={selectThemesView}
          onSelectGlossary={selectGlossaryView}
        />

        <div className={styles.panel}>
          {!selection && (
            <p className={styles.emptyState}>
              左のツリーからStrategy・Standing Background・Policy・Goal・Themes・Glossaryを選択してください。
            </p>
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

          {selection?.kind === "policies" && (
            <PolicyPanel key={navToken} policies={policies} policiesLoaded={policiesLoaded} refreshPolicies={refreshPolicies} />
          )}

          {selection?.kind === "goals" && (
            <GoalsPanel
              key={navToken}
              goals={goals}
              goalsLoaded={goalsLoaded}
              refreshGoals={refreshGoals}
              teamOptions={teamOptions}
              refreshThemes={refreshThemes}
            />
          )}

          {selection?.kind === "themes" && (
            <OrgThemesPanel
              themes={themes}
              themesLoaded={themesLoaded}
              goals={goals}
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

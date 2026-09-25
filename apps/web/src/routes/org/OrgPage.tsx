import { useState } from "react";
import styles from "../../styles/page.module.css";
import { PageTitleRow } from "../../components/HelpLink";
import { OrgLeftTree, type Selection } from "../../components/org/OrgLeftTree";
import { OrgOverviewPanel } from "../../components/org/OrgOverviewPanel";
import type { OrgEmptyKind } from "../../components/org/OrgEmptyGuidance";
import { OrgThemesPanel } from "../../components/org/OrgThemesPanel";
import { GlossaryPanel } from "../../components/org/GlossaryPanel";
import { GoalsPanel } from "../../components/org/GoalsPanel";
import { PolicyPanel } from "../../components/org/PolicyPanel";
import { StandingBackgroundPanel } from "../../components/org/StandingBackgroundPanel";
import { StrategyPanel } from "../../components/org/StrategyPanel";
import { useGoals, useOrgBackgrounds, useOrgStrategy, usePolicies, useTeams, useThemes } from "../../lib/queries";
import { teamDisplayName } from "@emther/core/types";
import { orgSearchSchema } from "@/router";
import { useTypedSearchParams } from "../../lib/useTypedSearchParams";

// フラットナビ + 概要（全体スキャン → フォーカス）
export function OrgPage() {
  const [orgSearch] = useTypedSearchParams(orgSearchSchema);
  const { strategy, strategyLoaded, refreshStrategy } = useOrgStrategy();
  const { backgrounds, backgroundsLoaded, refreshBackgrounds } = useOrgBackgrounds();
  const { policies, policiesLoaded, refreshPolicies } = usePolicies();
  const { goals, goalsLoaded, refreshGoals } = useGoals();
  const { teams, teamsLoaded } = useTeams();
  const { themes, themesLoaded, refreshThemes } = useThemes();
  const activeTeams = teams.filter((t) => !t.archived);
  const teamOptions = activeTeams.map((t) => ({ value: t.id, label: teamDisplayName(t.name) }));
  const adoptedThemes = themes.filter((t) => t.status === "adopted");

  const [selection, setSelection] = useState<Selection>(() =>
    orgSearch.section === "themes" ? { kind: "themes" } : { kind: "overview" },
  );
  const [editingThemeId, setEditingThemeId] = useState<string | null>(() =>
    orgSearch.section === "themes" && orgSearch.themeId ? orgSearch.themeId : null,
  );
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);

  // 各パネルは選択中(kind一致)のときだけマウントされ、内部stateはアンマウントで
  // 自然にリセットされる。ただし「同じツリー項目を選択中にもう一度クリックする」場合は
  // kindが変わらずマウントされ続けるため、navTokenをkeyに含めて強制的に再マウントし、
  // 元の実装（クリックのたびに一覧へ戻す）と同じ挙動にする。
  const [navToken, setNavToken] = useState(0);

  // URL の section/themeId が変わったら Themes へ寄せる（壁打ち定着後の遷移用）
  const deepLinkKey = `${orgSearch.section ?? ""}:${orgSearch.themeId ?? ""}`;
  const [appliedDeepLinkKey, setAppliedDeepLinkKey] = useState(deepLinkKey);
  if (appliedDeepLinkKey !== deepLinkKey) {
    setAppliedDeepLinkKey(deepLinkKey);
    if (orgSearch.section === "themes") {
      setSelection({ kind: "themes" });
      setEditingThemeId(orgSearch.themeId ?? null);
    }
  }

  function selectOverview() {
    setSelection({ kind: "overview" });
    setNavToken((n) => n + 1);
  }

  function selectStrategy() {
    setSelection({ kind: "strategy" });
    setNavToken((n) => n + 1);
  }

  function selectBackgroundsView() {
    setSelection({ kind: "backgrounds" });
    setNavToken((n) => n + 1);
  }

  function selectPoliciesView() {
    setEditingPolicyId(null);
    setSelection({ kind: "policies" });
  }

  function selectGoalsView() {
    setEditingGoalId(null);
    setSelection({ kind: "goals" });
  }

  function selectThemesView() {
    setEditingThemeId(null);
    setSelection({ kind: "themes" });
  }

  function selectGlossaryView() {
    setSelection({ kind: "glossary" });
    setNavToken((n) => n + 1);
  }

  function placeDraft(kind: OrgEmptyKind) {
    if (kind === "mvv") selectStrategy();
    else if (kind === "goals") selectGoalsView();
    else if (kind === "policies") selectPoliciesView();
    else selectThemesView();
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
          onSelectOverview={selectOverview}
          onSelectStrategy={selectStrategy}
          onSelectBackgrounds={selectBackgroundsView}
          onSelectPolicies={selectPoliciesView}
          onSelectGoals={selectGoalsView}
          onSelectThemes={selectThemesView}
          onSelectGlossary={selectGlossaryView}
        />

        <div className={styles.panel}>
          {selection?.kind === "overview" && (
            <OrgOverviewPanel
              key={navToken}
              strategy={strategy}
              strategyLoaded={strategyLoaded}
              goals={goals}
              goalsLoaded={goalsLoaded}
              policies={policies}
              policiesLoaded={policiesLoaded}
              themes={themes}
              themesLoaded={themesLoaded}
              onPlaceDraft={placeDraft}
              onOpenThemes={selectThemesView}
            />
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

          {selection?.kind === "goals" && (
            <GoalsPanel
              goals={goals}
              goalsLoaded={goalsLoaded}
              refreshGoals={refreshGoals}
              teamOptions={teamOptions}
              refreshThemes={refreshThemes}
              editingGoalId={editingGoalId}
              onSelectGoal={(goal) => setEditingGoalId(goal.id)}
              onBack={() => setEditingGoalId(null)}
            />
          )}

          {selection?.kind === "policies" && (
            <PolicyPanel
              policies={policies}
              policiesLoaded={policiesLoaded}
              refreshPolicies={refreshPolicies}
              editingPolicyId={editingPolicyId}
              onSelectPolicy={(policy) => setEditingPolicyId(policy.id)}
              onBack={() => setEditingPolicyId(null)}
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

          {selection?.kind === "backgrounds" && (
            <StandingBackgroundPanel
              key={navToken}
              backgrounds={backgrounds}
              backgroundsLoaded={backgroundsLoaded}
              refreshBackgrounds={refreshBackgrounds}
            />
          )}

          {selection?.kind === "glossary" && <GlossaryPanel key={navToken} />}
        </div>
      </div>
    </div>
  );
}

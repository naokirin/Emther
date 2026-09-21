import styles from "../../styles/page.module.css";

export type Selection =
  | { kind: "strategy" }
  | { kind: "backgrounds" }
  | { kind: "policies" }
  | { kind: "goals" }
  | { kind: "themes" }
  | { kind: "glossary" }
  | null;

type Props = {
  selection: Selection;
  backgroundsLoaded: boolean;
  activeBackgroundsCount: number;
  policiesLoaded: boolean;
  activePoliciesCount: number;
  goalsLoaded: boolean;
  activeGoalsCount: number;
  themesLoaded: boolean;
  adoptedThemesCount: number;
  onSelectStrategy: () => void;
  onSelectBackgrounds: () => void;
  onSelectPolicies: () => void;
  onSelectGoals: () => void;
  onSelectThemes: () => void;
  onSelectGlossary: () => void;
};

export function OrgLeftTree({
  selection,
  backgroundsLoaded,
  activeBackgroundsCount,
  policiesLoaded,
  activePoliciesCount,
  goalsLoaded,
  activeGoalsCount,
  themesLoaded,
  adoptedThemesCount,
  onSelectStrategy,
  onSelectBackgrounds,
  onSelectPolicies,
  onSelectGoals,
  onSelectThemes,
  onSelectGlossary,
}: Props) {
  return (
    <div className={styles.panel}>
      <div className={styles.tree}>
        <div className={styles.treeFolder}>📁 MVV</div>
        <div
          className={`${styles.treeFile} ${selection?.kind === "strategy" ? styles.treeFileSelected : ""}`}
          onClick={onSelectStrategy}
        >
          📄 MVV
        </div>

        <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Goal（到達したい状態）</div>
        <div
          className={`${styles.treeFile} ${selection?.kind === "goals" ? styles.treeFileSelected : ""}`}
          onClick={onSelectGoals}
        >
          📄 Goal
          {goalsLoaded && activeGoalsCount > 0 ? `（${activeGoalsCount}件）` : ""}
        </div>

        <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Policy（判断原則）</div>
        <div
          className={`${styles.treeFile} ${selection?.kind === "policies" ? styles.treeFileSelected : ""}`}
          onClick={onSelectPolicies}
        >
          📄 Policy
          {policiesLoaded && activePoliciesCount > 0 ? `（${activePoliciesCount}件）` : ""}
        </div>

        <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Themes（今期の焦点）</div>
        <div
          className={`${styles.treeFile} ${selection?.kind === "themes" ? styles.treeFileSelected : ""}`}
          onClick={onSelectThemes}
        >
          📄 Themes
          {themesLoaded && adoptedThemesCount > 0 ? `（採用 ${adoptedThemesCount}件）` : ""}
        </div>

        <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Standing Background（長期の背景事実）</div>
        <div
          className={`${styles.treeFile} ${selection?.kind === "backgrounds" ? styles.treeFileSelected : ""}`}
          onClick={onSelectBackgrounds}
        >
          📄 Standing Background
          {backgroundsLoaded && activeBackgroundsCount > 0 ? `（${activeBackgroundsCount}件）` : ""}
        </div>

        <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Glossary（社内用語・辞書）</div>
        <div
          className={`${styles.treeFile} ${selection?.kind === "glossary" ? styles.treeFileSelected : ""}`}
          onClick={onSelectGlossary}
        >
          📄 Glossary
        </div>
      </div>
    </div>
  );
}

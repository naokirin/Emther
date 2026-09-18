"use client";

import styles from "@/app/page.module.css";
import { PageTitleRow } from "@/components/HelpLink";

export type Selection =
  | { kind: "strategy" }
  | { kind: "backgrounds" }
  | { kind: "objectives" }
  | { kind: "themes" }
  | { kind: "glossary" }
  | null;

type Props = {
  selection: Selection;
  backgroundsLoaded: boolean;
  activeBackgroundsCount: number;
  objectivesLoaded: boolean;
  objectivesCount: number;
  themesLoaded: boolean;
  adoptedThemesCount: number;
  onSelectStrategy: () => void;
  onSelectBackgrounds: () => void;
  onSelectObjectives: () => void;
  onSelectThemes: () => void;
  onSelectGlossary: () => void;
};

export function OrgLeftTree({
  selection,
  backgroundsLoaded,
  activeBackgroundsCount,
  objectivesLoaded,
  objectivesCount,
  themesLoaded,
  adoptedThemesCount,
  onSelectStrategy,
  onSelectBackgrounds,
  onSelectObjectives,
  onSelectThemes,
  onSelectGlossary,
}: Props) {
  return (
    <div className={styles.panel}>
      <PageTitleRow title="方針・目標" helpAnchor="org" />

      <div className={styles.tree} style={{ marginTop: 14 }}>
        <div className={styles.treeFolder}>📁 Strategy（MVV）</div>
        <div
          className={`${styles.treeFile} ${selection?.kind === "strategy" ? styles.treeFileSelected : ""}`}
          onClick={onSelectStrategy}
        >
          📄 Strategy
        </div>

        <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Standing Background</div>
        <div
          className={`${styles.treeFile} ${selection?.kind === "backgrounds" ? styles.treeFileSelected : ""}`}
          onClick={onSelectBackgrounds}
        >
          📄 Standing Background
          {backgroundsLoaded && activeBackgroundsCount > 0 ? `（${activeBackgroundsCount}件）` : ""}
        </div>

        <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Objectives（OKR）</div>
        <div
          className={`${styles.treeFile} ${selection?.kind === "objectives" ? styles.treeFileSelected : ""}`}
          onClick={onSelectObjectives}
        >
          📄 Objectives
          {objectivesLoaded && objectivesCount > 0 ? `（${objectivesCount}件）` : ""}
        </div>

        <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 Themes</div>
        <div
          className={`${styles.treeFile} ${selection?.kind === "themes" ? styles.treeFileSelected : ""}`}
          onClick={onSelectThemes}
        >
          📄 Themes
          {themesLoaded && adoptedThemesCount > 0 ? `（採用 ${adoptedThemesCount}件）` : ""}
        </div>

        <div className={styles.treeFolder} style={{ marginTop: 10 }}>📁 社内用語（辞書）</div>
        <div
          className={`${styles.treeFile} ${selection?.kind === "glossary" ? styles.treeFileSelected : ""}`}
          onClick={onSelectGlossary}
        >
          📄 Glossary（社内用語）
        </div>
      </div>
    </div>
  );
}

import styles from "../../styles/page.module.css";

export type Selection =
  | { kind: "overview" }
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
  onSelectOverview: () => void;
  onSelectStrategy: () => void;
  onSelectBackgrounds: () => void;
  onSelectPolicies: () => void;
  onSelectGoals: () => void;
  onSelectThemes: () => void;
  onSelectGlossary: () => void;
};

type NavItem = {
  kind: NonNullable<Selection>["kind"];
  title: string;
  desc: string;
  count?: string | null;
  onSelect: () => void;
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
  onSelectOverview,
  onSelectStrategy,
  onSelectBackgrounds,
  onSelectPolicies,
  onSelectGoals,
  onSelectThemes,
  onSelectGlossary,
}: Props) {
  const items: NavItem[] = [
    {
      kind: "overview",
      title: "概要",
      desc: "いまのレンズ（全体スキャン）",
      onSelect: onSelectOverview,
    },
    {
      kind: "strategy",
      title: "MVV",
      desc: "Mission / Vision / Values",
      onSelect: onSelectStrategy,
    },
    {
      kind: "goals",
      title: "Goal",
      desc: "組織・チームの到達状態",
      count: goalsLoaded && activeGoalsCount > 0 ? `${activeGoalsCount}件` : null,
      onSelect: onSelectGoals,
    },
    {
      kind: "policies",
      title: "Policy",
      desc: "組織・チームの判断原則",
      count: policiesLoaded && activePoliciesCount > 0 ? `${activePoliciesCount}件` : null,
      onSelect: onSelectPolicies,
    },
    {
      kind: "themes",
      title: "Themes",
      desc: "EMの今の焦点",
      count: themesLoaded && adoptedThemesCount > 0 ? `採用 ${adoptedThemesCount}件` : null,
      onSelect: onSelectThemes,
    },
    {
      kind: "backgrounds",
      title: "Standing Background",
      desc: "長期の背景事実",
      count: backgroundsLoaded && activeBackgroundsCount > 0 ? `${activeBackgroundsCount}件` : null,
      onSelect: onSelectBackgrounds,
    },
    {
      kind: "glossary",
      title: "Glossary",
      desc: "社内用語・辞書",
      onSelect: onSelectGlossary,
    },
  ];

  return (
    <div className={styles.panel}>
      <nav className={styles.orgNavList} aria-label="方針・目標の区分">
        {items.map((item) => {
          const selected = selection?.kind === item.kind;
          return (
            <button
              key={item.kind}
              type="button"
              className={`${styles.orgNavItem} ${selected ? styles.orgNavItemSelected : ""}`}
              onClick={item.onSelect}
              aria-current={selected ? "page" : undefined}
            >
              <span className={styles.orgNavItemBody}>
                <span className={styles.orgNavTitle}>{item.title}</span>
                <span className={styles.orgNavDesc}>{item.desc}</span>
              </span>
              {item.count ? <span className={styles.orgNavCount}>{item.count}</span> : null}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

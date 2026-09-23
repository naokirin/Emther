import styles from "../../styles/page.module.css";

// docs/memo.md「O. 期初の憲法づくりオンボーディング」および goal.pen 方針:
// 無いときは観測・相談を主経路にし、方針・目標への「置く」は副経路。
type Props = {
  setupGaps: string[];
  teamsCount: number;
  hasMvv: boolean;
  goalsCount: number;
  onNavigate: (path: string) => void;
};

export function SetupGapsBanner({ setupGaps, teamsCount, hasMvv, goalsCount, onNavigate }: Props) {
  if (setupGaps.length === 0) return null;
  const needsOrgLens = !hasMvv || goalsCount === 0;
  return (
    <div
      className={styles.panel}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 16px",
        background: "var(--yellow-bg)",
        border: "1px solid var(--yellow-border)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: "0.875rem" }}>レンズの抜け: {setupGaps.join("・")}</span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
          主経路は観測・相談から。必要なら曖昧なまま方針・目標に置いてよい。
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flexShrink: 0 }}>
        {teamsCount === 0 && (
          <button className={styles.btnOutline} onClick={() => onNavigate("/teams")}>
            チームへ
          </button>
        )}
        {needsOrgLens ? (
          <>
            <button className={styles.btnOutline} onClick={() => onNavigate("/journal")}>
              ジャーナルで考える
            </button>
            <button className={styles.btnOutline} onClick={() => onNavigate("/chat")}>
              相談で考える
            </button>
            <button className={styles.btnOutline} onClick={() => onNavigate("/org")}>
              方針・目標に置く
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

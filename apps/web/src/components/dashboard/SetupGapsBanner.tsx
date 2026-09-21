import styles from "../../styles/page.module.css";

// docs/memo.md「O. 期初の憲法づくりオンボーディング」対応。空の前提のままエージェントが
// 走らないよう、MVV/Team/Goalが揃うまでセットアップ導線を出す。新規ウィザード画面は
// 増やさず、既存の/orgへの案内に留める（EMが明示的に消せるものではなく、実際に揃うと
// 自然に消える）。
type Props = {
  setupGaps: string[];
  teamsCount: number;
  hasMvv: boolean;
  goalsCount: number;
  onNavigate: (path: string) => void;
};

export function SetupGapsBanner({ setupGaps, teamsCount, hasMvv, goalsCount, onNavigate }: Props) {
  if (setupGaps.length === 0) return null;
  return (
    <div
      className={styles.panel}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 16px",
        background: "var(--yellow-bg)",
        border: "1px solid var(--yellow-border)",
      }}
    >
      <span style={{ fontSize: "0.875rem" }}>⚙️ 初回セットアップ: {setupGaps.join("・")}</span>
      {/* ユーザー要望「チーム・メンバータブにチームの追加・編集を統合したい」対応。チームの
          追加は/teams（チーム・メンバータブの「チーム」）へ、MVV/Goalの設定は
          方針・目標タブへ、と行き先が分かれたためボタンも分ける（不足している方だけ出す）。 */}
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        {teamsCount === 0 && (
          <button className={styles.btnOutline} onClick={() => onNavigate("/teams")}>
            チームへ
          </button>
        )}
        {!hasMvv || goalsCount === 0 ? (
          <button className={styles.btnOutline} onClick={() => onNavigate("/org")}>
            方針・目標へ
          </button>
        ) : null}
      </div>
    </div>
  );
}

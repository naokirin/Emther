import { Link } from "react-router";
import styles from "../../styles/page.module.css";

export type OrgEmptyKind = "mvv" | "goals" | "policies" | "themes";

type Props = {
  kinds: OrgEmptyKind[];
  /** 曖昧なまま区分編集へ置く副経路 */
  onPlaceDraft?: (kind: OrgEmptyKind) => void;
};

const COPY: Record<OrgEmptyKind, { title: string; body: string; placeLabel: string }> = {
  mvv: {
    title: "MVV がまだない",
    body: "白紙から埋めなくてよい。日々の観測・相談で言語化したものを、ここに定着させる。",
    placeLabel: "曖昧なまま MVV を置く",
  },
  goals: {
    title: "Goal がまだない",
    body: "到達したい状態は、ジャーナルや相談で見えてからでよい。必要なら短い一文から置ける。",
    placeLabel: "曖昧なまま Goal を置く",
  },
  policies: {
    title: "Policy がまだない",
    body: "判断原則も必須の初期入力ではない。迷ったときの軸が見えたら置く。",
    placeLabel: "曖昧なまま Policy を置く",
  },
  themes: {
    title: "採用 Theme がまだない",
    body: "今見る焦点は、提案や振り返りから採用してきてもよい。",
    placeLabel: "Themes 一覧へ",
  },
};

/**
 * 未設定時の補足。主経路は観測・相談、副経路は曖昧なまま置く。
 * 「ないからこの画面で考え始める」を主役にしない。
 */
export function OrgEmptyGuidance({ kinds, onPlaceDraft }: Props) {
  if (kinds.length === 0) return null;

  return (
    <div className={styles.orgEmptyGuide} role="region" aria-label="未設定の補足">
      {kinds.map((kind) => {
        const c = COPY[kind];
        return (
          <div key={kind}>
            <p className={styles.orgEmptyGuideTitle}>{c.title}</p>
            <p className={styles.orgEmptyGuideBody}>{c.body}</p>
          </div>
        );
      })}
      <div className={styles.orgEmptyGuideActions}>
        <Link to="/journal" className={styles.btnOutline} style={{ display: "inline-block" }}>
          ジャーナルで考える
        </Link>
        <Link to="/chat" className={styles.btnOutline} style={{ display: "inline-block" }}>
          相談で考える
        </Link>
        <Link to="/suggestions" className={styles.btnOutline} style={{ display: "inline-block" }}>
          提案を見る
        </Link>
      </div>
      {onPlaceDraft ? (
        <div className={styles.orgEmptyGuideActions}>
          <p className={styles.orgEmptyGuideSecondary}>副経路:</p>
          {kinds.map((kind) => (
            <button
              key={`place-${kind}`}
              type="button"
              className={styles.btnOutline}
              onClick={() => onPlaceDraft(kind)}
            >
              {COPY[kind].placeLabel}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

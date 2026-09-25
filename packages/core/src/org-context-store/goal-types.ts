export type GoalHorizon = "long" | "mid" | "near";
export type GoalStatus = "active" | "achieved" | "abandoned";

export type Goal = {
  id: string;
  title: string;
  /** 補足（解釈を閉じる説明・任意）。運用メモとは別。 */
  elaboration?: string;
  note?: string;
  teamId?: string;
  /**
   * 上位 Goal の ID（多対多）。チーム階層とは独立。
   * 空・未定義＝上位リンクなし。下位側は他 Goal の parentGoalIds から導出する。
   */
  parentGoalIds?: string[];
  horizon?: GoalHorizon;
  status: GoalStatus;
  /** 一覧の手動並び順（昇順）。 */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

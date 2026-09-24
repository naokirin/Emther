export type GoalHorizon = "long" | "mid" | "near";
export type GoalStatus = "active" | "achieved" | "abandoned";

export type Goal = {
  id: string;
  title: string;
  /** 補足（解釈を閉じる説明・任意）。運用メモとは別。 */
  elaboration?: string;
  note?: string;
  teamId?: string;
  horizon?: GoalHorizon;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
};

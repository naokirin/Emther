export type GlossaryEntry = {
  id: string;
  term: string;
  reading?: string;
  meaning: string;
  category?: string;
  /** 外部AI向けマスクID（TERM_n）。表示時は term に戻す。 */
  maskId: string;
  /** true のときだけ保存・外部送信時に TERM_n へマスクする（既定 false）。 */
  maskEnabled: boolean;
  /** マスク対象のとき、TERM_n と組で外部AIへ送ってよい補足。meaning は送らない。 */
  externalHint?: string;
  createdAt: number;
  updatedAt: number;
};

export type NewGlossaryInput = {
  term: string;
  reading?: string;
  meaning: string;
  category?: string;
  maskEnabled?: boolean;
  externalHint?: string;
};

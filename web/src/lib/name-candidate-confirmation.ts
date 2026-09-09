// ローカルNERの人名候補を「自動登録」せず、厳格モード時にEMへ確認するための共通プロトコル。
// 誤登録が assertNoRealNamesLeaked を誤発火させて Agent送信全体を止める問題への対策
// （docs/memo.md / em_human_story_and_ux.md P2-12）。
// 現行方針では名簿の事前登録が正で、既定の保存・送信パスはNER確認ゲートを走らせない。
// このプロトコルは allowUnmaskedCandidates:false 等の明示オプトイン時にだけ使う。

export const NAME_CANDIDATE_CONFIRMATION_CODE = "NAME_CANDIDATE_CONFIRMATION_REQUIRED" as const;

export const NAME_CANDIDATE_CONFIRMATION_MESSAGE =
  "未登録の人名らしい語句があります。ヘッダーの「＋人を追加」で登録するか、このまま未マスクで進めてよいですか？後でAIが外部へ送信する可能性があります。";

export type NameCandidateConfirmationBody = {
  code: typeof NAME_CANDIDATE_CONFIRMATION_CODE;
  candidates: string[];
  message: string;
};

export type MaskOptions = {
  /**
   * true: NERで未登録候補を検出し許可リストへ入れて進める。
   * false: NERで検出し、未許可なら UnconfirmedNameCandidatesError。
   * 未指定: NERを起動しない（事前登録が正。登録済みのみ後続マスク）。
   */
  allowUnmaskedCandidates?: boolean;
  /** trueのとき、検出された未登録候補を人名として登録し、マスクして進める */
  registerNameCandidates?: boolean;
};

export class UnconfirmedNameCandidatesError extends Error {
  readonly candidates: string[];

  constructor(candidates: string[]) {
    super(formatNameCandidateConfirmationMessage(candidates));
    this.name = "UnconfirmedNameCandidatesError";
    this.candidates = candidates;
  }
}

export function formatNameCandidateConfirmationMessage(candidates: string[]): string {
  const listed =
    candidates.length > 0
      ? candidates.map((c) => `「${c}」`).join("、")
      : "（候補の取得に失敗しました）";
  return `次の語句が人名の可能性があり、マスクされずに残ります: ${listed}。ヘッダーの「＋人を追加」で登録するか、未マスクのまま進めてよいですか？後でAIが外部へ送信する可能性があります。`;
}

export function isUnconfirmedNameCandidatesError(err: unknown): err is UnconfirmedNameCandidatesError {
  if (err instanceof UnconfirmedNameCandidatesError) return true;
  // Next.js のモジュール分割で instanceof が外れることがあるため、名前と candidates でも判定する。
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; candidates?: unknown };
  return e.name === "UnconfirmedNameCandidatesError" && Array.isArray(e.candidates);
}

export function nameCandidateConfirmationBody(candidates: string[]): NameCandidateConfirmationBody {
  return {
    code: NAME_CANDIDATE_CONFIRMATION_CODE,
    candidates,
    message: formatNameCandidateConfirmationMessage(candidates),
  };
}

export function isNameCandidateConfirmation(data: unknown): data is NameCandidateConfirmationBody {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    d.code === NAME_CANDIDATE_CONFIRMATION_CODE &&
    Array.isArray(d.candidates) &&
    d.candidates.every((c) => typeof c === "string") &&
    d.candidates.length > 0
  );
}

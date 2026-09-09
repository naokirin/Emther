// ローカルNERの人名候補を「自動登録」せず、EMに「未マスクのまま進めてよいか」を
// 確認するための共通プロトコル。誤登録が assertNoRealNamesLeaked を誤発火させて
// Agent送信全体を止める問題への対策（docs/memo.md / em_human_story_and_ux.md P2-12）。

export const NAME_CANDIDATE_CONFIRMATION_CODE = "NAME_CANDIDATE_CONFIRMATION_REQUIRED" as const;

export const NAME_CANDIDATE_CONFIRMATION_MESSAGE =
  "未登録の人名らしい語句があります。人名として登録はせず、このまま進めてよいですか？後でAIが外部へ送信する可能性があります。";

export type NameCandidateConfirmationBody = {
  code: typeof NAME_CANDIDATE_CONFIRMATION_CODE;
  candidates: string[];
  message: string;
};

export type MaskOptions = {
  /** trueのとき、検出された未登録候補を許可リストへ入れたうえで既知名のみマスクして進める */
  allowUnmaskedCandidates?: boolean;
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
  return `次の語句が人名の可能性があり、マスクされずに残ります: ${listed}。人名として登録はせず、このまま進めてよいですか？後でAIが外部へ送信する可能性があります。`;
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

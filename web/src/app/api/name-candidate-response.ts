import { NextResponse } from "next/server";
import { isUnconfirmedNameCandidatesError, nameCandidateConfirmationBody } from "@core/name-candidate-confirmation";

// フレームワーク非依存の部分（MaskOptions組み立てロジック）は packages/core へ移設済み
// （docs/2nd_architecture/plan.md フェーズ2.5）。ここでは既存呼び出し元との互換のため re-export する。
export {
  parseAllowUnmaskedCandidates,
  parseRegisterNameCandidates,
  maskOptionsFromBody,
  maskOptionsFromBodyStrict,
} from "@core/name-candidate-response";

export function jsonFromUnknownError(err: unknown, fallbackStatus = 500): NextResponse {
  if (isUnconfirmedNameCandidatesError(err)) {
    const candidates = err.candidates.filter((c) => typeof c === "string" && c.trim());
    return NextResponse.json(nameCandidateConfirmationBody(candidates), { status: 409 });
  }
  // duck-typing でも拾えないが message だけ一致するケース向けの最後の手段は設けない
  // （誤って通常エラーを確認ダイアログ化しない）。
  return NextResponse.json({ error: (err as Error).message }, { status: fallbackStatus });
}

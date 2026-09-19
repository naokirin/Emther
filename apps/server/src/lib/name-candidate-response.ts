import { isUnconfirmedNameCandidatesError, nameCandidateConfirmationBody } from "@emther/core/name-candidate-confirmation";

// web/src/app/api/name-candidate-response.ts のHono版。フレームワーク非依存の部分
// （MaskOptions組み立てロジック）は packages/core にあるため、ここではHTTPフレームワーク
// 固有のエラーレスポンス整形だけを持つ（docs/2nd_architecture/plan.md フェーズ2.5）。
export {
  parseAllowUnmaskedCandidates,
  parseRegisterNameCandidates,
  maskOptionsFromBody,
  maskOptionsFromBodyStrict,
} from "@emther/core/name-candidate-response";

export function jsonFromUnknownError(err: unknown, fallbackStatus = 500): Response {
  if (isUnconfirmedNameCandidatesError(err)) {
    const candidates = err.candidates.filter((c) => typeof c === "string" && c.trim());
    return Response.json(nameCandidateConfirmationBody(candidates), { status: 409 });
  }
  return Response.json({ error: (err as Error).message }, { status: fallbackStatus });
}

import { isUnconfirmedNameCandidatesError, nameCandidateConfirmationBody } from "@emther/core/name-candidate-confirmation";

// Hono向けの名前候補エラー整形。MaskOptions組み立ては packages/core 側にあり、
// ここでは HTTP フレームワーク固有のレスポンス整形だけを持つ。
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

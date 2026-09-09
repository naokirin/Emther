import { NextResponse } from "next/server";
import {
  isUnconfirmedNameCandidatesError,
  nameCandidateConfirmationBody,
  type MaskOptions,
} from "@/lib/name-candidate-confirmation";

export function parseAllowUnmaskedCandidates(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as Record<string, unknown>).allowUnmaskedNameCandidates === true;
}

export function parseRegisterNameCandidates(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as Record<string, unknown>).registerNameCandidates === true;
}

/** API body から MaskOptions を組み立てる。登録指定がある場合は未マスク許可より優先。 */
export function maskOptionsFromBody(body: unknown): MaskOptions {
  const registerNameCandidates = parseRegisterNameCandidates(body);
  return {
    registerNameCandidates,
    allowUnmaskedCandidates: !registerNameCandidates && parseAllowUnmaskedCandidates(body),
  };
}

export function jsonFromUnknownError(err: unknown, fallbackStatus = 500): NextResponse {
  if (isUnconfirmedNameCandidatesError(err)) {
    const candidates = err.candidates.filter((c) => typeof c === "string" && c.trim());
    return NextResponse.json(nameCandidateConfirmationBody(candidates), { status: 409 });
  }
  // duck-typing でも拾えないが message だけ一致するケース向けの最後の手段は設けない
  // （誤って通常エラーを確認ダイアログ化しない）。
  return NextResponse.json({ error: (err as Error).message }, { status: fallbackStatus });
}

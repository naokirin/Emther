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

/** API body から MaskOptions を組み立てる。フラグ未指定時は空（NERゲートなし＝事前登録が正）。 */
export function maskOptionsFromBody(body: unknown): MaskOptions {
  if (parseRegisterNameCandidates(body)) {
    return { registerNameCandidates: true };
  }
  if (parseAllowUnmaskedCandidates(body)) {
    return { allowUnmaskedCandidates: true };
  }
  return {};
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

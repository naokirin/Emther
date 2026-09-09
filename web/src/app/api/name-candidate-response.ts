import { NextResponse } from "next/server";
import {
  isUnconfirmedNameCandidatesError,
  nameCandidateConfirmationBody,
} from "@/lib/name-candidate-confirmation";

export function parseAllowUnmaskedCandidates(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as Record<string, unknown>).allowUnmaskedNameCandidates === true;
}

export function jsonFromUnknownError(err: unknown, fallbackStatus = 500): NextResponse {
  if (isUnconfirmedNameCandidatesError(err)) {
    return NextResponse.json(nameCandidateConfirmationBody(err.candidates), { status: 409 });
  }
  return NextResponse.json({ error: (err as Error).message }, { status: fallbackStatus });
}

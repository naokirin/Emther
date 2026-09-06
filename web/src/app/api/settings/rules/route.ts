import { NextResponse } from "next/server";
import { getRulesAndConstraints, updateRulesAndConstraints } from "@/lib/settings-store";

export async function GET() {
  return NextResponse.json({ rules: getRulesAndConstraints() });
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const patch = {
    teamWindowDays: num(body?.teamWindowDays),
    minEntriesForJudgement: num(body?.minEntriesForJudgement),
    teamBadSentimentMax: num(body?.teamBadSentimentMax),
    teamWarnSentimentMax: num(body?.teamWarnSentimentMax),
    coverageWindowDays: num(body?.coverageWindowDays),
    coverageGoodRatio: num(body?.coverageGoodRatio),
    coverageWarnRatio: num(body?.coverageWarnRatio),
    agentStaleAfterSeconds: num(body?.agentStaleAfterSeconds),
    agentKillAfterSeconds: num(body?.agentKillAfterSeconds),
  };
  const filtered = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const rules = updateRulesAndConstraints(filtered);
  return NextResponse.json({ rules });
}

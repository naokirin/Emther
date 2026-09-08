import { NextResponse } from "next/server";
import { getRulesAndConstraints, updateRulesAndConstraints } from "@/lib/settings-store";

export async function GET() {
  return NextResponse.json({ rules: getRulesAndConstraints() });
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

// maxParallelAgentRunsが0以下だと、どのエージェントも永久にキューから出られなくなる
// （デッドロック）ため、最低1は保証する。
function positiveInt(value: unknown): number | undefined {
  const n = num(value);
  return n !== undefined ? Math.max(1, Math.round(n)) : undefined;
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
    journalFactTtlDays: num(body?.journalFactTtlDays),
    agyFallbackAgents: Array.isArray(body?.agyFallbackAgents)
      ? body.agyFallbackAgents.filter((a: unknown): a is string => typeof a === "string")
      : undefined,
    cursorFallbackAgents: Array.isArray(body?.cursorFallbackAgents)
      ? body.cursorFallbackAgents.filter((a: unknown): a is string => typeof a === "string")
      : undefined,
    autoAnomalyDetectionEnabled: bool(body?.autoAnomalyDetectionEnabled),
    autoMorningSummaryEnabled: bool(body?.autoMorningSummaryEnabled),
    autoMorningSummaryHour: num(body?.autoMorningSummaryHour),
    maxParallelAgentRuns: positiveInt(body?.maxParallelAgentRuns),
  };
  const filtered = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const rules = updateRulesAndConstraints(filtered);
  return NextResponse.json({ rules });
}

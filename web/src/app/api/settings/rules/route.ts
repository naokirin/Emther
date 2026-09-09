import { NextResponse } from "next/server";
import { getRulesAndConstraints, updateRulesAndConstraints } from "@/lib/settings-store";
import { AGENT_OPTIONS, MODEL_TIER_OPTIONS, type ModelTier } from "@/lib/types";

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

// AGENT_OPTIONSに無いキーやMODEL_TIER_OPTIONSに無い値は黙って落とす（不正な--model値を
// そのままclaude CLIに渡さないため）。値が空文字列のエージェントはキー自体を落とし、
// 「claude CLIの既定モデルのまま」に戻す。
function agentModelTiers(value: unknown): Partial<Record<string, ModelTier>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result: Partial<Record<string, ModelTier>> = {};
  for (const [agentName, tier] of Object.entries(value as Record<string, unknown>)) {
    if (!AGENT_OPTIONS.includes(agentName)) continue;
    if (typeof tier !== "string" || tier === "") continue;
    if (!(MODEL_TIER_OPTIONS as readonly string[]).includes(tier)) continue;
    result[agentName] = tier as ModelTier;
  }
  return result;
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
    decisionQueueLimit: positiveInt(body?.decisionQueueLimit),
    observationQueueLimit: positiveInt(body?.observationQueueLimit),
    staleInterventionDays: positiveInt(body?.staleInterventionDays),
    agentModelTiers: agentModelTiers(body?.agentModelTiers),
  };
  const filtered = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const rules = updateRulesAndConstraints(filtered);
  return NextResponse.json({ rules });
}

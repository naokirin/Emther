import { NextResponse } from "next/server";
import { getRulesAndConstraints, updateRulesAndConstraints } from "@/lib/settings-store";
import { AGENT_OPTIONS, CLI_OPTIONS, MODEL_TIER_OPTIONS, type CliName, type ModelTier } from "@/lib/types";

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

// ユーザー要望「エージェント種別ごとのモデル系統に関して、Cursor/agyについても調整
// できるようにしたい」対応。agentModelTiersと違いモデル名は自由入力（エイリアスが無い
// ため）なので、値自体の妥当性は検証しない（trimして空になったキーは既定へ戻す）。
function agentCliModels(value: unknown): Partial<Record<string, string>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result: Partial<Record<string, string>> = {};
  for (const [agentName, model] of Object.entries(value as Record<string, unknown>)) {
    if (!AGENT_OPTIONS.includes(agentName)) continue;
    if (typeof model !== "string") continue;
    const trimmed = model.trim();
    if (!trimmed) continue;
    result[agentName] = trimmed;
  }
  return result;
}

// ユーザー要望「利用するAIツールの優先度を設定で変更できるようにしたい」対応。
// CLI_OPTIONSの並べ替え（重複無し・過不足無し）でなければ黙って落とす（不正な設定で
// runClaudeTurnが候補ゼロになってrunが何も試さず終わる、といった事態を防ぐ）。
function cliPriorityOrder(value: unknown): CliName[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.filter((v): v is string => typeof v === "string");
  if (names.length !== CLI_OPTIONS.length) return undefined;
  const unique = new Set(names);
  if (unique.size !== CLI_OPTIONS.length) return undefined;
  if (!CLI_OPTIONS.every((c) => unique.has(c))) return undefined;
  return names as CliName[];
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
    agentAgyModels: agentCliModels(body?.agentAgyModels),
    agentCursorModels: agentCliModels(body?.agentCursorModels),
    cliPriorityOrder: cliPriorityOrder(body?.cliPriorityOrder),
  };
  const filtered = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const rules = updateRulesAndConstraints(filtered);
  return NextResponse.json({ rules });
}

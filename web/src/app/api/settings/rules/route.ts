import { NextResponse } from "next/server";
import {
  getRulesAndConstraints,
  normalizeHourList,
  normalizeWeekdayList,
  updateRulesAndConstraints,
} from "@core/settings-store";
import { listPeople } from "@core/people-directory";
import { isLocalChatModelPresetId, type LocalChatModelPresetId } from "@core/local-chat-presets";
import { ensureLocalModels } from "@/lib/model-loader";
import { AGENT_OPTIONS, CLI_OPTIONS, MODEL_TIER_OPTIONS, type CliName, type ModelTier } from "@core/types";

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

// perTurnBudgetUsdはclaudeの--max-budget-usdに渡す。0以下だと即失敗するため最低0.01を保証し、
// セント単位に丸める。
function positiveUsd(value: unknown): number | undefined {
  const n = num(value);
  return n !== undefined ? Math.max(0.01, Math.round(n * 100) / 100) : undefined;
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

// ユーザー指摘「AIツールの優先度設定が増えたことでフォールバック設定との競合が発生
// している」「エージェントごとに設定できる必要はない、全体で1つで大丈夫」
// 「claude codeが外せないようになっている」対応。以前のcliPriorityOrder
// （全エージェント共通の並び順）とagyFallbackAgents/cursorFallbackAgents
// （エージェント種別ごとのON/OFF）を統合した、全エージェント共通のCLI優先順位
// リスト。配列に含まれるCLIだけが候補（＝含まれないCLIは除外）で、含まれる順が
// 試行順（＝優先度）。claudeも他の2つと同様に除外できる。CLI_OPTIONSに無い値・
// 重複を含む配列・空配列は黙って落とす（不正な設定でrunClaudeTurnが候補ゼロに
// なってrunが何も試さず終わる、といった事態を防ぐ）。
function cliOrder(value: unknown): CliName[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.filter((v): v is string => typeof v === "string");
  if (names.length === 0 || names.length !== value.length) return undefined;
  const unique = new Set(names);
  if (unique.size !== names.length) return undefined;
  if (!names.every((n) => (CLI_OPTIONS as readonly string[]).includes(n))) return undefined;
  return names as CliName[];
}

function localChatModelPreset(value: unknown): LocalChatModelPresetId | undefined {
  return isLocalChatModelPresetId(value) ? value : undefined;
}

// ユーザー要望「この検索（Grow参考リンクのWebSearch）で使うモデル設定を追加してほしい」
// 対応。agentModelTiersと同じ検証（MODEL_TIER_OPTIONSに無い値は黙って落とす）。
// 空文字列は「claude CLIの既定モデルのまま」を意味する有効値として許容する。
function referenceLookupClaudeModel(value: unknown): ModelTier | "" | undefined {
  if (value === "") return "";
  if (typeof value !== "string") return undefined;
  return (MODEL_TIER_OPTIONS as readonly string[]).includes(value) ? (value as ModelTier) : undefined;
}

// ユーザー要望「Cursorでは、AutoはHooksの不具合のため指定できないようにしておいて
// ほしい（設定しようとしたらユーザーにCursorの不具合で設定できない旨を表示）」対応。
// フロントエンド（AiToolsSettingsGroup.tsx）でも同じ内容を即時に弾いているが、
// APIを直接叩く経路への保険として、ここでも"auto"（大小文字・前後空白は無視）は
// エラーとして拒否する（selfPersonIdの400と同じ既存パターン）。それ以外の値は
// agentCliModelsと同じくバージョン付きの具体名でしか指定できない制約のため
// 自由入力で検証しない。
function parseReferenceLookupCursorModel(
  value: unknown,
): { ok: true; value: string } | { ok: false; error: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return { ok: false, error: "referenceLookupCursorModelは文字列である必要があります" };
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "auto") {
    return {
      ok: false,
      error:
        "Cursor CLIの既知の不具合（Autoモデルルーティング時にpreToolUseフックが発火しない）のため、この検索のCursorモデルにAutoは指定できません。",
    };
  }
  return { ok: true, value: trimmed };
}

// ユーザー要望「メンバーに自分自身を追加したいが区別できない」対応。
// null / 空文字 = 解除。存在する PERSON_n のみ受け付ける（不正IDは undefined で無視しないよう
// 呼び出し側で 400 にする）。
function parseSelfPersonId(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } | undefined {
  if (value === undefined) return undefined;
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "selfPersonIdは文字列またはnullである必要があります" };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!listPeople().some((p) => p.id === trimmed)) {
    return { ok: false, error: "指定された人物が見つかりません" };
  }
  return { ok: true, value: trimmed };
}

function hourList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return undefined;
  if (!value.every((h) => typeof h === "number" && Number.isFinite(h))) return undefined;
  return normalizeHourList(value);
}

function weekdayList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return undefined;
  if (!value.every((d) => typeof d === "number" && Number.isFinite(d))) return undefined;
  return normalizeWeekdayList(value);
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const selfPersonParsed = parseSelfPersonId(body?.selfPersonId);
  if (selfPersonParsed && !selfPersonParsed.ok) {
    return NextResponse.json({ error: selfPersonParsed.error }, { status: 400 });
  }
  const referenceLookupCursorModelParsed = parseReferenceLookupCursorModel(body?.referenceLookupCursorModel);
  if (referenceLookupCursorModelParsed && !referenceLookupCursorModelParsed.ok) {
    return NextResponse.json({ error: referenceLookupCursorModelParsed.error }, { status: 400 });
  }
  const previousPreset = getRulesAndConstraints().localChatModelPreset;
  // 旧キー autoJournalBatchHour / autoDistillationWeekday も受け付け、配列へ寄せる。
  const legacyJournalHour = num(body?.autoJournalBatchHour);
  const journalHours =
    hourList(body?.autoJournalBatchHours) ??
    (legacyJournalHour !== undefined ? normalizeHourList([legacyJournalHour]) : undefined);
  const legacyDistillWeekday = num(body?.autoDistillationWeekday);
  const distillWeekdays =
    weekdayList(body?.autoDistillationWeekdays) ??
    (legacyDistillWeekday !== undefined
      ? normalizeWeekdayList([Math.min(6, Math.max(0, Math.round(legacyDistillWeekday)))])
      : undefined);
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
    autoIssueUpdateAnalysisEnabled: bool(body?.autoIssueUpdateAnalysisEnabled),
    autoMorningSummaryEnabled: bool(body?.autoMorningSummaryEnabled),
    autoMorningSummaryHour: num(body?.autoMorningSummaryHour),
    autoJournalBatchEnabled: bool(body?.autoJournalBatchEnabled),
    autoJournalBatchHours: journalHours,
    autoDistillationEnabled: bool(body?.autoDistillationEnabled),
    autoDistillationWeekdays: distillWeekdays,
    autoDistillationHour:
      num(body?.autoDistillationHour) !== undefined
        ? Math.min(23, Math.max(0, Math.round(num(body?.autoDistillationHour)!)))
        : undefined,
    autoGrowEnabled: bool(body?.autoGrowEnabled),
    autoGrowWeekday:
      num(body?.autoGrowWeekday) !== undefined ? Math.min(6, Math.max(0, Math.round(num(body?.autoGrowWeekday)!))) : undefined,
    autoGrowHour:
      num(body?.autoGrowHour) !== undefined ? Math.min(23, Math.max(0, Math.round(num(body?.autoGrowHour)!))) : undefined,
    maxParallelAgentRuns: positiveInt(body?.maxParallelAgentRuns),
    perTurnBudgetUsd: positiveUsd(body?.perTurnBudgetUsd),
    teamParallelKickoffEnabled: bool(body?.teamParallelKickoffEnabled),
    decisionQueueLimit: positiveInt(body?.decisionQueueLimit),
    observationQueueLimit: positiveInt(body?.observationQueueLimit),
    staleInterventionDays: positiveInt(body?.staleInterventionDays),
    agentModelTiers: agentModelTiers(body?.agentModelTiers),
    agentAgyModels: agentCliModels(body?.agentAgyModels),
    agentCursorModels: agentCliModels(body?.agentCursorModels),
    referenceLookupClaudeModel: referenceLookupClaudeModel(body?.referenceLookupClaudeModel),
    referenceLookupCursorModel: referenceLookupCursorModelParsed?.ok ? referenceLookupCursorModelParsed.value : undefined,
    cliOrder: cliOrder(body?.cliOrder),
    selfPersonId: selfPersonParsed?.ok ? selfPersonParsed.value : undefined,
    localChatModelPreset: localChatModelPreset(body?.localChatModelPreset),
  };
  const filtered = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const rules = updateRulesAndConstraints(filtered);
  // プリセット変更時は新モデルのキャッシュ確認／未取得ならダウンロードを開始する
  // （バナー表示のため ensure を起こす。失敗しても設定保存自体は成功扱い）。
  if (rules.localChatModelPreset !== previousPreset) {
    void ensureLocalModels();
  }
  return NextResponse.json({ rules });
}

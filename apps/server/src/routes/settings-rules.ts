import { Hono } from "hono";
import { z } from "zod";
import { getRulesAndConstraints, normalizeHourList, normalizeWeekdayList, updateRulesAndConstraints } from "@emther/core/settings-store";
import { listPeople } from "@emther/core/people-directory";
import { isLocalChatModelPresetId, type LocalChatModelPresetId } from "@emther/core/local-chat-presets";
import { ensureLocalModels } from "@emther/core/model-loader";
import { AGENT_OPTIONS, CLI_OPTIONS, MODEL_TIER_OPTIONS, type CliName, type ModelTier } from "@emther/core/types";

// docs/2nd_architecture/plan.md フェーズ2.5: web/src/app/api/settings/rules/route.ts の移植。

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// docs/2nd_architecture/plan.md フェーズ2.6: 単純な数値・真偽値フィールド（ビジネスロジックの
// 分岐を伴わないもの）はZodスキーマに置き換える。既存の num()/bool() と同じ「型が違う値は
// 黙って undefined 扱いにする」寛容さを1:1で保つため、各フィールドに .catch() を付ける
// （PERSON_n照合やCLI名一覧チェック等、DB参照や個別エラーメッセージを伴うフィールドは
// 対象外とし、従来どおり専用関数で扱う）。
const numberField = z.number().finite().optional().catch(undefined);
const booleanField = z.boolean().optional().catch(undefined);
const settingsRulesPatchSchema = z
  .object({
    teamWindowDays: numberField,
    minEntriesForJudgement: numberField,
    teamBadSentimentMax: numberField,
    teamWarnSentimentMax: numberField,
    coverageWindowDays: numberField,
    coverageGoodRatio: numberField,
    coverageWarnRatio: numberField,
    agentStaleAfterSeconds: numberField,
    agentKillAfterSeconds: numberField,
    journalFactTtlDays: numberField,
    autoSuggestionUpdateAnalysisEnabled: booleanField,
    autoMorningSummaryEnabled: booleanField,
    autoMorningSummaryHour: numberField,
    autoJournalBatchEnabled: booleanField,
    autoJournalBatchHour: numberField, // 旧キー（互換）
    autoDistillationEnabled: booleanField,
    autoDistillationWeekday: numberField, // 旧キー（互換）
    autoDistillationHour: numberField,
    autoGrowEnabled: booleanField,
    autoGrowWeekday: numberField,
    autoGrowHour: numberField,
    autoWeeklyReportEnabled: booleanField,
    autoWeeklyReportWeekday: numberField,
    autoWeeklyReportHour: numberField,
    autoMonthlyReportEnabled: booleanField,
    autoMonthlyReportDay: numberField,
    autoMonthlyReportHour: numberField,
    teamParallelKickoffEnabled: booleanField,
    localRerankEnabled: booleanField,
  })
  .catch({});

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

export const settingsRulesRoute = new Hono()
  .get("/", (c) => c.json({ rules: getRulesAndConstraints() }))
  .patch("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = settingsRulesPatchSchema.parse(body);
    const selfPersonParsed = parseSelfPersonId(body?.selfPersonId);
    if (selfPersonParsed && !selfPersonParsed.ok) {
      return c.json({ error: selfPersonParsed.error }, 400);
    }
    const referenceLookupCursorModelParsed = parseReferenceLookupCursorModel(body?.referenceLookupCursorModel);
    if (referenceLookupCursorModelParsed && !referenceLookupCursorModelParsed.ok) {
      return c.json({ error: referenceLookupCursorModelParsed.error }, 400);
    }
    const previousPreset = getRulesAndConstraints().localChatModelPreset;
    // 旧キー autoJournalBatchHour / autoDistillationWeekday も受け付け、配列へ寄せる。
    const journalHours =
      hourList(body?.autoJournalBatchHours) ??
      (parsed.autoJournalBatchHour !== undefined ? normalizeHourList([parsed.autoJournalBatchHour]) : undefined);
    const distillWeekdays =
      weekdayList(body?.autoDistillationWeekdays) ??
      (parsed.autoDistillationWeekday !== undefined
        ? normalizeWeekdayList([Math.min(6, Math.max(0, Math.round(parsed.autoDistillationWeekday)))])
        : undefined);
    const patch = {
      teamWindowDays: parsed.teamWindowDays,
      minEntriesForJudgement: parsed.minEntriesForJudgement,
      teamBadSentimentMax: parsed.teamBadSentimentMax,
      teamWarnSentimentMax: parsed.teamWarnSentimentMax,
      coverageWindowDays: parsed.coverageWindowDays,
      coverageGoodRatio: parsed.coverageGoodRatio,
      coverageWarnRatio: parsed.coverageWarnRatio,
      agentStaleAfterSeconds: parsed.agentStaleAfterSeconds,
      agentKillAfterSeconds: parsed.agentKillAfterSeconds,
      journalFactTtlDays: parsed.journalFactTtlDays,
      autoSuggestionUpdateAnalysisEnabled: parsed.autoSuggestionUpdateAnalysisEnabled,
      autoMorningSummaryEnabled: parsed.autoMorningSummaryEnabled,
      autoMorningSummaryHour: parsed.autoMorningSummaryHour,
      autoJournalBatchEnabled: parsed.autoJournalBatchEnabled,
      autoJournalBatchHours: journalHours,
      autoDistillationEnabled: parsed.autoDistillationEnabled,
      autoDistillationWeekdays: distillWeekdays,
      autoDistillationHour:
        parsed.autoDistillationHour !== undefined
          ? Math.min(23, Math.max(0, Math.round(parsed.autoDistillationHour)))
          : undefined,
      autoGrowEnabled: parsed.autoGrowEnabled,
      autoGrowWeekday:
        parsed.autoGrowWeekday !== undefined ? Math.min(6, Math.max(0, Math.round(parsed.autoGrowWeekday))) : undefined,
      autoGrowHour:
        parsed.autoGrowHour !== undefined ? Math.min(23, Math.max(0, Math.round(parsed.autoGrowHour))) : undefined,
      autoWeeklyReportEnabled: parsed.autoWeeklyReportEnabled,
      autoWeeklyReportWeekday:
        parsed.autoWeeklyReportWeekday !== undefined
          ? Math.min(6, Math.max(0, Math.round(parsed.autoWeeklyReportWeekday)))
          : undefined,
      autoWeeklyReportHour:
        parsed.autoWeeklyReportHour !== undefined
          ? Math.min(23, Math.max(0, Math.round(parsed.autoWeeklyReportHour)))
          : undefined,
      autoMonthlyReportEnabled: parsed.autoMonthlyReportEnabled,
      autoMonthlyReportDay:
        parsed.autoMonthlyReportDay !== undefined
          ? Math.min(28, Math.max(1, Math.round(parsed.autoMonthlyReportDay)))
          : undefined,
      autoMonthlyReportHour:
        parsed.autoMonthlyReportHour !== undefined
          ? Math.min(23, Math.max(0, Math.round(parsed.autoMonthlyReportHour)))
          : undefined,
      maxParallelAgentRuns: positiveInt(body?.maxParallelAgentRuns),
      perTurnBudgetUsd: positiveUsd(body?.perTurnBudgetUsd),
      teamParallelKickoffEnabled: parsed.teamParallelKickoffEnabled,
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
      localRerankEnabled: parsed.localRerankEnabled,
    };
    const filtered = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const rules = updateRulesAndConstraints(filtered);
    // プリセット変更時は新モデルのキャッシュ確認／未取得ならダウンロードを開始する
    // （バナー表示のため ensure を起こす。失敗しても設定保存自体は成功扱い）。
    if (rules.localChatModelPreset !== previousPreset) {
      void ensureLocalModels();
    }
    return c.json({ rules });
  });

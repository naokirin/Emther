import { loadJSON, saveJSON } from "./persistence";
import type { LocalChatModelPresetId } from "./local-chat-presets";
import type { CliName, ModelTier } from "./types";

// docs 3.1.1「判定閾値およびデータ欠如とみなす期間はCore Context（Rules_and_Constraints）
// 側で定義」に対応するパラメータ群。ただしこれは「組織のMVV/体制」のような
// ナレッジ（Organization Context）ではなく、アプリの動作を調整する設定値の性質が強いため、
// org-context-store（Organization Context）とは分離し、独立したSettingsとして持つ。

export type RulesAndConstraints = {
  teamWindowDays: number;
  minEntriesForJudgement: number;
  teamBadSentimentMax: number;
  teamWarnSentimentMax: number;
  coverageWindowDays: number;
  coverageGoodRatio: number;
  coverageWarnRatio: number;
  // 「動いていると思ったら止まっていた」を防ぐための閾値（docs/memo.md TODO対応）。
  // statusが"active"のままログ更新（updatedAt）がこの秒数以上無い場合は「応答なし」と
  // みなしてEMに警告表示する（実プロセスは殺さない、あくまでシグナル）。
  agentStaleAfterSeconds: number;
  // 上記よりさらに長くログ更新が無い場合は、ハングした子プロセスとみなして
  // 実際にkillし、"error"へ確定させる（ゾンビプロセス化を防ぐ自己修復）。
  agentKillAfterSeconds: number;
  // docs/memo.md「H: 永続化データモデルの設計」対応。Journalの投稿はkind:"fact"の
  // KnowledgeEventとして記録されるが、一時的な感情・発言は時間とともに現在の判断への
  // 重みを失わせるべき（ファクトと解釈の分離）。この日数を過ぎたJournalファクトは
  // Agent Runtimeへの注入対象から外れる（削除はされない、履歴としては残る）。
  journalFactTtlDays: number;
  // 提案のタイトル・メモが更新されたとき、紐付きRunの継続分析 or 新規Lead起動。
  // 既定OFF（コスト発生のopt-in）。
  autoIssueUpdateAnalysisEnabled: boolean;
  // バッチ駆動: 毎日この時刻（EMのブラウザではなくサーバーのローカル時刻）以降、最初のwatchdog
  // tickで一度だけLead Agentへ朝のサマリー作成タスクを投げる。
  autoMorningSummaryEnabled: boolean;
  autoMorningSummaryHour: number;
  // ユーザー要望「提案はJournal1回ごとに毎回検討するのではなく、一定期間分をまとめて
  // 解釈する」対応。以前あったJournal校正のたびの即時個別分析（イベント駆動、
  // 緊急度・感情フィルタで対象を絞る方式）は廃止し、直近のJournalをまとめてLead Agentに
  // 解釈させるバッチ駆動へ一本化した。EMが能動的に「相談」したときの個別分析
  // （POST /api/journal/[id]/analyze）はこれとは別に従来どおり残る。既定OFF。
  // 起動時刻は複数指定可（サーバーローカル 0〜23）。材料は前回カバー以降（最大7日）。
  autoJournalBatchEnabled: boolean;
  autoJournalBatchHours: number[];
  // docs/knowledge_distillation.md。状況蒸留（テーマ解釈候補）。既定OFF。
  // 曜日は複数選択可（0=日曜 … 6=土曜）。同じ週に複数回起動できる。
  autoDistillationEnabled: boolean;
  autoDistillationWeekdays: number[];
  // サーバーローカル時刻の時（0〜23）。既定8。
  autoDistillationHour: number;
  // docs/2nd_pivot_version.md Phase 8。EM自身の学びの提案（Grow）の週次バッチ。既定OFF。
  autoGrowEnabled: boolean;
  // 0=日曜 … 6=土曜（Date.getDay()と同じ）。既定1=月曜。
  autoGrowWeekday: number;
  // サーバーローカル時刻の時（0〜23）。既定8。
  autoGrowHour: number;
  // ユーザー指摘「設定変更時に、それまで起動していなかったエージェントが一気に並列で
  // 起動することがある」対応。エージェントは1体につき1つのCLI子プロセス（claude/agy/
  // cursor-agent）を起動するため、無制限に並列起動を許すとメモリを大量消費し環境が
  // 不安定になる。ここで同時に「実行中」にできるCLI子プロセス数の上限を設け、
  // 超過分はキューイングして順番に起動する（agent-runtime.tsのacquireRunSlot）。
  maxParallelAgentRuns: number;
  // claude CLIの1ターンあたりの予算上限（--max-budget-usd）。既定0.5はSonnet等向けで、
  // Opus既定の環境では起動直後に予算超過で失敗しやすい。agy/cursor側には相当オプションが
  // 無いため、この値はclaude試行にのみ効く。
  perTurnBudgetUsd: number;
  // 提案紐付きのLead起動時、関連specialistを先に並列起動し、その結果をLeadが統合する。
  // 既定ON（チーム分析の本筋）。OFFにすると従来どおりLead単独起動＋任意consult。
  teamParallelKickoffEnabled: boolean;
  // docs/em_ui_ux_issue.md 2.2/4節「AI主導トリアージ・上限N件への圧縮」対応。Morning Modeで
  // 前面に出す「判断待ち（decision）」「観測不足（observation）」レーンそれぞれの表示上限。
  // 超過分は非表示にはせず、「もっと見る」で追加表示できる。
  decisionQueueLimit: number;
  observationQueueLimit: number;
  // docs/2nd_pivot_version.md Phase 7。未確認・確認保留の提案が何日動きが無ければ
  // 「停滞」としてバイタルやメンバー詳細で強調するかの閾値。既定14日。
  staleInterventionDays: number;
  // ユーザー要望「エージェントが使うモデルを設定で事前に決めたい」対応。AGENT_OPTIONSの
  // 値をキーにした、エージェント種別ごとのモデル系統（claude CLIの--modelが受け付ける
  // エイリアス。バージョンは固定しない）指定。キーが無い（または空文字列の）エージェントは
  // claude CLIの既定モデルのまま動く（既定は全エージェント未設定＝既存の挙動を変えない）。
  agentModelTiers: Partial<Record<string, ModelTier>>;
  // ユーザー要望「エージェント種別ごとのモデル系統に関して、Cursor/agyについても調整
  // できるようにしたい」対応。claudeと違い、agy/cursorのモデルはエイリアスではなく
  // バージョン付きの具体名でしか指定できない実機確認済みの制約があるため、自由入力の
  // 文字列にする。キーが無い（または空文字列の）エージェントはagent-runtime.tsの
  // 既定モデル定数のまま動く。
  agentAgyModels: Partial<Record<string, string>>;
  agentCursorModels: Partial<Record<string, string>>;
  // ユーザー要望「この検索（Grow参考リンクのWebSearch）で使うモデル設定を追加してほしい。
  // 他のタスクに比べてもコストが低く軽量なモデルで良いはず」対応。詳細は@/lib/types.tsの
  // 同名の型を参照。
  referenceLookupClaudeModel: ModelTier | "";
  referenceLookupCursorModel: string;
  // ユーザー指摘「AIツールの優先度設定が増えたことでフォールバック設定との競合が
  // 発生している」「エージェントごとに設定できる必要はない、全体で1つで大丈夫」
  // 「claude codeが外せないようになっている」対応。以前のcliPriorityOrder
  // （全エージェント共通の並び順）+ agyFallbackAgents/cursorFallbackAgents
  // （エージェント種別ごとのON/OFF）を、全エージェント共通の単一のCLI優先順位
  // リストへ統合したもの。配列に含まれるCLIだけが候補（除外＝配列から外す）で、
  // 含まれる順が試行順（優先度）。claudeも含め除外可能（空配列にはできない）。
  // 詳細は@/lib/types.tsの同名の型を参照。
  cliOrder: CliName[];
  // ユーザー要望「メンバーに自分自身を追加したいが区別できない」対応。
  // Peopleに登録済みの PERSON_n を「利用者本人（EM）」として紐付ける任意設定。
  // null/未設定時は従来どおり（誰も本人扱いにしない）。1on1 Coverage・部下一覧から除外し、
  // Org Context注入では本人である旨を明示するために使う。
  selfPersonId: string | null;
  // ユーザー要望「メモリに余裕がある場合にローカルAIをより大きいパラメータ数へ」対応。
  // Journal抽出・人物名検出など Transformers.js のチャット用ローカルモデルのプリセット。
  // 既定 "350m"。埋め込みモデルは対象外。
  localChatModelPreset: LocalChatModelPresetId;
};

const DEFAULT_RULES: RulesAndConstraints = {
  teamWindowDays: 14,
  minEntriesForJudgement: 2,
  teamBadSentimentMax: -0.34,
  teamWarnSentimentMax: 0.2,
  coverageWindowDays: 30,
  coverageGoodRatio: 0.8,
  coverageWarnRatio: 0.4,
  agentStaleAfterSeconds: 120,
  agentKillAfterSeconds: 600,
  journalFactTtlDays: 90,
  autoIssueUpdateAnalysisEnabled: false,
  autoMorningSummaryEnabled: false,
  autoMorningSummaryHour: 7,
  autoJournalBatchEnabled: false,
  autoJournalBatchHours: [7],
  autoDistillationEnabled: false,
  autoDistillationWeekdays: [1],
  autoDistillationHour: 8,
  autoGrowEnabled: false,
  autoGrowWeekday: 1,
  autoGrowHour: 8,
  maxParallelAgentRuns: 2,
  perTurnBudgetUsd: 0.5,
  teamParallelKickoffEnabled: true,
  decisionQueueLimit: 3,
  observationQueueLimit: 3,
  staleInterventionDays: 14,
  agentModelTiers: {},
  agentAgyModels: {},
  agentCursorModels: {},
  referenceLookupClaudeModel: "",
  referenceLookupCursorModel: "",
  cliOrder: ["claude"],
  selfPersonId: null,
  localChatModelPreset: "1.2b-jp",
};

/** 0〜23 の時刻配列を重複除去・昇順・最低1件に正規化する。 */
export function normalizeHourList(value: unknown, fallback: number[] = [7]): number[] {
  const from = (arr: unknown): number[] => {
    if (!Array.isArray(arr)) return [];
    return [
      ...new Set(
        arr
          .filter((h): h is number => typeof h === "number" && Number.isFinite(h))
          .map((h) => Math.min(23, Math.max(0, Math.round(h)))),
      ),
    ].sort((a, b) => a - b);
  };
  const hours = from(value);
  if (hours.length > 0) return hours;
  const fb = from(fallback);
  return fb.length > 0 ? fb : [7];
}

/** 0〜6 の曜日配列を重複除去・昇順・最低1件に正規化する。 */
export function normalizeWeekdayList(value: unknown, fallback: number[] = [1]): number[] {
  const from = (arr: unknown): number[] => {
    if (!Array.isArray(arr)) return [];
    return [
      ...new Set(
        arr
          .filter((d): d is number => typeof d === "number" && Number.isFinite(d))
          .map((d) => Math.min(6, Math.max(0, Math.round(d)))),
      ),
    ].sort((a, b) => a - b);
  };
  const days = from(value);
  if (days.length > 0) return days;
  const fb = from(fallback);
  return fb.length > 0 ? fb : [1];
}

// 旧キー autoJournalBatchHour / autoDistillationWeekday からの移行を含む。
type LegacyRulesFile = Partial<RulesAndConstraints> & {
  autoJournalBatchHour?: number;
  autoDistillationWeekday?: number;
};

function hydrateRules(raw: LegacyRulesFile): RulesAndConstraints {
  // 旧キーは配列へ寄せたあと残さない（settings-rules.json へ書き戻さないため）。
  const { autoJournalBatchHour: legacyHour, autoDistillationWeekday: legacyWeekday, ...rest } = raw;
  const merged: RulesAndConstraints = { ...DEFAULT_RULES, ...(rest as Partial<RulesAndConstraints>) };
  if (Array.isArray(raw.autoJournalBatchHours) && raw.autoJournalBatchHours.length > 0) {
    merged.autoJournalBatchHours = normalizeHourList(raw.autoJournalBatchHours);
  } else if (typeof legacyHour === "number" && Number.isFinite(legacyHour)) {
    merged.autoJournalBatchHours = normalizeHourList([legacyHour]);
  } else {
    merged.autoJournalBatchHours = [...DEFAULT_RULES.autoJournalBatchHours];
  }
  if (Array.isArray(raw.autoDistillationWeekdays) && raw.autoDistillationWeekdays.length > 0) {
    merged.autoDistillationWeekdays = normalizeWeekdayList(raw.autoDistillationWeekdays);
  } else if (typeof legacyWeekday === "number" && Number.isFinite(legacyWeekday)) {
    merged.autoDistillationWeekdays = normalizeWeekdayList([legacyWeekday]);
  } else {
    merged.autoDistillationWeekdays = [...DEFAULT_RULES.autoDistillationWeekdays];
  }
  merged.autoDistillationHour = Math.min(
    23,
    Math.max(0, Math.round(merged.autoDistillationHour ?? DEFAULT_RULES.autoDistillationHour)),
  );
  return merged;
}

let rules: RulesAndConstraints = hydrateRules(loadJSON<LegacyRulesFile>("settings-rules.json", {}));

function persistRules(): void {
  saveJSON("settings-rules.json", rules);
}

export function getRulesAndConstraints(): RulesAndConstraints {
  return rules;
}

export function updateRulesAndConstraints(patch: Partial<RulesAndConstraints>): RulesAndConstraints {
  const next: RulesAndConstraints = { ...rules, ...patch };
  if (patch.autoJournalBatchHours !== undefined) {
    next.autoJournalBatchHours = normalizeHourList(patch.autoJournalBatchHours, rules.autoJournalBatchHours);
  }
  if (patch.autoDistillationWeekdays !== undefined) {
    next.autoDistillationWeekdays = normalizeWeekdayList(
      patch.autoDistillationWeekdays,
      rules.autoDistillationWeekdays,
    );
  }
  if (patch.autoDistillationHour !== undefined) {
    next.autoDistillationHour = Math.min(23, Math.max(0, Math.round(patch.autoDistillationHour)));
  }
  rules = next;
  persistRules();
  return rules;
}

/** 利用者本人として紐付いている PERSON_n。未設定なら null。 */
export function getSelfPersonId(): string | null {
  return rules.selfPersonId ?? null;
}

/** 本人紐付けを設定／解除する（nullで解除）。 */
export function setSelfPersonId(personId: string | null): RulesAndConstraints {
  return updateRulesAndConstraints({ selfPersonId: personId });
}

/**
 * 人物統合・削除時に selfPersonId を追従させる。
 * - fromId が本人なら toId へ付け替え
 * - deletedId が本人なら解除
 */
export function reassignSelfPersonId(opts: { fromId?: string; toId?: string; deletedId?: string }): void {
  const current = getSelfPersonId();
  if (!current) return;
  if (opts.deletedId && current === opts.deletedId) {
    setSelfPersonId(null);
    return;
  }
  if (opts.fromId && opts.toId && current === opts.fromId) {
    setSelfPersonId(opts.toId);
  }
}

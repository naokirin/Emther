import type { IssueCharter } from "@/lib/issue-store";
import type { SuggestedTheme } from "@/lib/theme-store";
import type { LookupRequest } from "@/lib/agent-knowledge-tools";
import type {
  ConfirmPriority,
  IssuePriority,
  PendingAgentStart,
  PendingAgentStartKind,
  PendingUnmaskedSend,
  SuggestionReviewStatus,
  YieldKind,
} from "@/lib/types";

export type { PendingAgentStart, PendingAgentStartKind, PendingUnmaskedSend };

// ユーザー指摘「設定変更時に、それまで起動していなかったエージェントが一気に並列で
// 起動することがある」対応。"queued"は同時実行数の上限（settings-store.tsの
// maxParallelAgentRuns）に達しているため、CLI子プロセスの起動を待っている状態
// （acquireRunSlot参照）。"active"は実際にCLI子プロセスが動いている状態で、
// 両者はEM向けUI上で区別して表示する。
export type AgentStatus = "active" | "queued" | "yield" | "idle" | "error";

export type YieldOption = {
  id: string;
  label: string;
  detail?: string;
  risk?: string;
};

export type YieldRequest = {
  reason: string;
  options: YieldOption[];
  // docs/em_ui_ux_issue.md 5節「Yield種別カードUI」対応。§2.3のDecide/Inform/Commitの区別。
  // 省略可能（既存run・AIが出力しなかった場合との後方互換）で、UI側（RunDetail.tsx）が
  // options.length===0かどうかからdecide/informへフォールバック推定する。
  kind?: YieldKind;
};

export type RejectedAlternative = {
  option: string;
  reason: string;
};

export type ProposalRecommendation = "issue" | "dismiss" | "watch";

// Intake（相談／Journal）から親なしの独立Issueを複数切る候補。
// 子Issue（sub_issues）とは別：こちらは最初から別介入として並列起票する。
export type IssueCandidate = {
  title: string;
  rationale?: string;
};

export type Proposal = {
  conclusion: string;
  facts: string[];
  logic: string;
  rejectedAlternatives: RejectedAlternative[];
  // docs/usage_issues U2。Journal自動分析など「追跡要否」を聞かれたときだけ使う。
  // 未指定の従来出力は手動トリアージのまま。
  recommendation?: ProposalRecommendation;
  // Issue化時に使う短い課題名。conclusion（判断の一文）とは別に持たせ、タイトルの途中切れを抑える。
  // 単一課題のとき。複数なら issueCandidates を優先（issueTitleは代表名として任意）。
  issueTitle?: string;
  // 別責任・別KR・別チームになりうる介入が同居するとき、親なしの複数候補。
  issueCandidates?: IssueCandidate[];
};

// docs/memo.md「M. AIエージェント“チーム”の本格協働」対応。以前は専門エージェント
// 1体のみに相談できたが（agent: string）、複数の専門エージェントへ同時に（並行して）
// 相談し、それぞれの回答を踏まえて結論を出せるようにする（agents: string[]）。
// 連鎖相談（専門エージェントがさらに別の専門エージェントに相談する）は無限ループ
// リスクがあるため引き続き禁止（specialistRunはallowConsult=falseで起動する）。
// docs/agent_specialization.md「6. Leadのconsult差分化」段階5対応。以前はagents全員へ
// 同一questionを送るしかなく、プロンプトで「宛先ごとに書き分けろ」と指示するだけだった
// （1つの質問文に複数の宛先向けの依頼を詰め込む書き方）。questionsは任意のagentName→
// 個別質問のマップで、指定が無いagentには従来どおりquestionが使われる（後方互換）。
export type ConsultRequest = {
  agents: string[];
  question: string;
  questions?: Record<string, string>;
};

// 子Issue分解案。文字列のみの旧形式もパース時に { title } へ正規化する。
export type SuggestedSubIssue = {
  title: string;
  priority?: IssuePriority;
};

// docs/memo.md「Agentが相談などから他Issueなどへ記録することができない」対応。
// lookupで見つけた「このタスクとは別の」Issueへの追記提案。EMが「採用」するまで
// 対象Issueのlog（IssueLogEntry）へは反映しない（action_items等と同じHuman-in-the-Loop）。
// 作成・ステータス変更等の破壊的操作は含めず、追記のみに限定する。
export type SuggestedIssueNote = {
  issueId: string;
  text: string;
};

// docs/suggestion_organize_via_consult.md。EMが相談で「提案を整理して」等と明示的に
// 依頼したときだけ、AIが既存提案（実在ID）の状態変更をまとめて提案する。EMが「まとめて
// 反映」するまで、Suggestion本体には一切書き込まない（issue_noteと同じHuman-in-the-Loop）。
// 「基本すべて可」（種類の制限を設けない）方針のため、フィールドはすべて任意。ただし
// reasonのみ必須（差分表示・監査のため、なぜその変更かを必ず添えさせる）。
export type SuggestionUpdate = {
  suggestionId: string;
  reviewStatus?: SuggestionReviewStatus;
  confirmPriority?: ConfirmPriority;
  // "YYYY-MM-DD"をdateStringToNoonTimestampで変換したタイムスタンプ。nullは期日解除。
  reviewDueAt?: number | null;
  // true=アーカイブ、false=アーカイブ解除。
  archived?: boolean;
  // 整理理由の一言メモ（採用時にSuggestion.memosへ追記する）。
  note?: string;
  reason: string;
};

export type LogLine = {
  ts: number;
  channel: "meta" | "agent" | "system";
  text: string;
};

export type AgentRun = {
  id: string;
  agentName: string;
  task: string;
  status: AgentStatus;
  sessionId?: string;
  // docs/memo.md「Claude Codeが使えない場合はagy経由でフォールバックする」対応。
  // agyの会話継続（--conversation）はclaudeのsessionIdとは別のID空間なので分けて持つ。
  agyConversationId?: string;
  // docs/memo.md「サポートするAIエージェントCLIにCursor CLIを追加する」対応。
  // cursor-agentの会話継続（--resume）もclaude/agyとは別のID空間なので分けて持つ。
  cursorSessionId?: string;
  log: LogLine[];
  yieldRequest?: YieldRequest;
  proposal?: Proposal;
  // docs/first_implession 3.8「壁打ちによるState更新」対応。AIが提案するAction Itemsの
  // 下書き。EMが個別に「採用」するまでIssue.actionItemsには反映されない。
  suggestedActionItems?: string[];
  // docs/memo.md「K. ズームイン／ズームアウトの協働計画」対応。トップレベルIssueが
  // 抽象的すぎると判断した場合にAIが提案する、具体的な子Issue案の下書き。EMが個別に
  // 「採用」するまで実際のサブIssueは作られない（action_itemsと同じHuman-in-the-Loop）。
  suggestedSubIssues?: SuggestedSubIssue[];
  // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
  // 対応。紐づくIssueのWhy/What/Howのうち未整理の項目をAIが埋める提案の下書き。
  // suggestedActionItems/suggestedSubIssuesと同じくEMが「採用」するまでIssue.charterへは
  // 反映しない（Human-in-the-Loopを維持）。埋める提案がある項目のみキーを持つ。
  suggestedCharter?: Partial<IssueCharter>;
  // 介入の優先帯（focus/normal/parked）の提案。採用までIssue.priorityへは反映しない。
  suggestedPriority?: IssuePriority;
  // docs/memo.md「Agentが相談などから他Issueなどへ記録することができない」対応。
  suggestedIssueNotes?: SuggestedIssueNote[];
  // docs/suggestion_organize_via_consult.md。EMが相談で明示的に依頼したときだけ、AIが
  // 提案する既存提案（実在ID）の状態変更下書き（reviewStatus/confirmPriority/
  // reviewDueAt/archived/メモ）。EMが「まとめて反映」するまでSuggestion本体には反映しない。
  suggestedSuggestionUpdates?: SuggestionUpdate[];
  // docs/knowledge_distillation.md。状況蒸留で提案するテーマ解釈の下書き。
  // EMが「採用」するまで OrgTheme(adopted) にはならない。
  suggestedThemes?: SuggestedTheme[];
  totalCostUsd: number;
  createdAt: number;
  updatedAt: number;
  // docs 3.3「階層型マルチエージェント」用。Lead Agentが専門エージェントに相談した際、
  // 相談先のrunにはconsultedBy（相談元のLead run id）を付与し、EM向けの表示で
  // 「誰から相談されたrunか」を追跡できるようにする。pendingConsultは
  // handleStreamEventからrunClaudeTurnへ「相談したい」を伝えるための一時フィールドで、
  // 外部からは基本的に参照しない。
  consultedBy?: string;
  pendingConsult?: ConsultRequest;
  // docs/usage_issues U19。アプリ側の読み取り専用照会（```lookup```）。pendingLookupは
  // consultと同様の一時フィールド。lookupRoundsは同一run内の追加照会回数（上限あり）。
  pendingLookup?: LookupRequest;
  lookupRounds?: number;
  // 個人情報の分離の「最後の砦」（ユーザー指摘対応）。実名リーク検知時、原因と見られる
  // 過去のナレッジイベントを自動アーカイブ（隔離）できた場合に、runClaudeTurnへ
  // 「1回だけ自動再分析してよい」と伝える一時フィールド（pendingConsult/pendingLookupと
  // 同様、外部からは基本的に参照しない）。
  nameLeakQuarantined?: boolean;
  // docs/first_implession 3.6「トリガー（起動条件）: イベント駆動・バッチ駆動・人間駆動」対応。
  // 既定の"manual"はこれまで通りEM/Issue経由での起動。"auto-anomaly"はEMが明示的に依頼した
  // Journal個別分析（POST /api/journal/[id]/analyze。かつてはJournal校正時の自動即時分析にも
  // 使われていたが、その事前フィルタ駆動の即時発火は廃止し"auto-journal-batch"へ一本化した）、
  // "auto-summary"は朝のバッチサマリー、"auto-issue-update"はIssueのWhy/What/How・経過ログ
  // 更新をきっかけにした再分析、"auto-distill"は週次／手動の状況蒸留（テーマ解釈候補）、
  // "auto-journal-batch"は直近のJournalをまとめて日次で解釈するバッチ。
  // reviewedはAI主導（"manual"以外）のrunに限り意味を持つ——EMがまだ内容を確認していない
  // 間はDashboardの「次にすべきこと」に居座らせ、見て見ぬふりをできないようにする。
  origin: "manual" | "auto-anomaly" | "auto-summary" | "auto-issue-update" | "auto-distill" | "auto-grow" | "auto-journal-batch";
  // Journal自動分析・Journalからの手動相談の生成元。originだけでは ID が残らない。
  sourceJournalId?: string;
  // 何でも相談でEMが「経営／役員目線も聞く」をONにしたときなど、Leadがproposal/yieldする前に
  // 必ずconsultへ含めなければならない専門エージェント名。メモリ上のみ（active中に効けば足りる）。
  requiredConsultAgents?: string[];
  reviewed: boolean;
  // docs/memo.md「B. 何でも相談↔Issueの昇格物語」対応。reviewed（bool）だけでは
  // 「様子見」（追跡は続けるが緊急ではない）と「却下」（対応不要）を区別できないため、
  // 明示的にEMが選んだ場合のみ値が入る別フィールドとして持つ。
  triageStatus?: "watching" | "dismissed";
  // docs/em_human_story_and_ux.md P0-3対応。triageStatusを設定した時刻。「様子見」が
  // 期限切れ（WATCH_RESURFACE_AFTER_MS超）になったら「次にすべきこと」へ再浮上させる判定に使う。
  triageAt?: number;
  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。誤って起票した・
  // テストで作った等の相談を、相談履歴一覧・AIの判断材料（context-blocks等）から除外する。
  archivedAt?: number;
};

// 自動起動originの表示名。Dashboard/Inbox/ログの語彙を揃える。
export function originLabel(origin: AgentRun["origin"]): string {
  if (origin === "auto-anomaly") return "Journal自動分析";
  if (origin === "auto-summary") return "朝のサマリー";
  if (origin === "auto-issue-update") return "提案更新分析";
  if (origin === "auto-distill") return "状況蒸留";
  if (origin === "auto-grow") return "学びの提案";
  if (origin === "auto-journal-batch") return "Journal集約解釈";
  return "手動";
}

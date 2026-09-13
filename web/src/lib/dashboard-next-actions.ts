// docs/em_human_story_and_ux.md TODO「ダッシュボードで『人間のEMが次になにをするべきか？』が
// すぐに分かり、詳細に遷移できる状態にする」への対応。Yield/Error/Issue charter未整理/
// Team Vitals不調などのシグナルを、EMが今すぐ対応すべき順（urgent→warn）に束ねて
// 1箇所に見せるための、JSXを持たない純粋なデータ組み立てロジック（app/page.tsxから分離）。
import { draftKindLabel, isDraftAwaitingTriage, runKindLabel, shouldOmitRunFromNextActions, type AgentRun } from "@/components/RunDetail";
import { formatPendingAgentStartText } from "@/components/PendingAgentStartNotice";
import {
  INTERVENTION_NEXT_ACTION_LIMIT,
  charterFilledCount,
  compareIssuesByPriority,
  issueNextAction,
  type Issue,
  type IssuePriority,
  type JournalEntry,
  type OrgVitals,
  type PendingAgentStart,
  type PendingUnmaskedSend,
  type PersonSummary,
} from "@/lib/types";

// docs/em_human_story_and_ux.md P0-1対応。「次にすべきこと」を単一リストのままにせず、
// 性質の異なる3つのレーンに分ける。判断待ち＝EMの決断がボトルネックになっているもの、
// 観測不足＝まだ決断材料が足りず観測を増やすべきもの、整備＝緊急ではないが整えたいもの。
export type Lane = "decision" | "observation" | "maintenance";

export const LANE_META: Record<Lane, { label: string; hint: string }> = {
  decision: { label: "判断待ち", hint: "EMが今すぐ決めれば前に進むもの" },
  observation: { label: "観測不足", hint: "決断の前に事実を集めたいもの" },
  maintenance: { label: "整備", hint: "急ぎではないが整えたいもの" },
};

export type NextAction = {
  id: string;
  severity: "urgent" | "warn";
  lane: Lane;
  icon: string;
  kindLabel: string;
  text: string;
  onSelect: () => void;
  // 改修依頼「何が新しく出てきたか（以前から変わったか）をより分かりやすく」対応。
  // このカードの根拠になった事実が発生・更新された時刻。前回このダッシュボードを
  // 開いた時刻（ローカルのlastSeenAt）と比較し、新着だけに「NEW」を出す。
  since: number;
  /** ヒーローCTAの短いラベル（未指定時は「開く」） */
  ctaLabel?: string;
};

/** ダッシュボードの「次の1手」優先度。起票待ちドラフト → 実行異常/Yield → その他判断 → 観測 → 整備。 */
export function heroRank(a: NextAction): number {
  if (a.id.startsWith("pending-unmasked-")) return 0;
  if (a.kindLabel === "ドラフトIssue" || a.id.startsWith("auto-") || a.id === "auto-bundle") return 1;
  if (a.kindLabel === "ドラフト分析中") return 2;
  if (a.id.startsWith("yield-") || a.id.startsWith("stale-") || a.id.startsWith("error-")) return 3;
  if (a.id.startsWith("journal-unconfirmed-")) return 4;
  if (a.lane === "decision" && a.severity === "urgent") return 5;
  if (a.lane === "decision") return 6;
  if (a.lane === "observation") return 7;
  return 8;
}

// UI/UX見直し（今日タブ）対応。「次の1手」を単一のヒーローだけでなく「今日やるべき3つ」
// として上位N件をまとめて取り出せるよう、単一ピック関数をランキング関数に一般化する。
export function rankActions(actions: NextAction[]): NextAction[] {
  return [...actions].sort((a, b) => {
    const rd = heroRank(a) - heroRank(b);
    if (rd !== 0) return rd;
    if (a.severity !== b.severity) return a.severity === "urgent" ? -1 : 1;
    return b.since - a.since;
  });
}

export function issueNeedsCharter(issue: Issue): boolean {
  return !issue.parentId && !issue.archived && charterFilledCount(issue.charter) < 3;
}

// docs/memo.md「C. Journalセンシング→行動」対応。urgency:highは既に自動検知(auto-anomaly)
// で拾われているため、「要注目だが自動起動しない」層（mid＋ネガティブ）を一定期間だけ
// 「次にすべきこと」に載せる。Journalには却下/確認済みの概念が無いため、無期限に残り続けない
// よう表示ウィンドウで自然に外れるようにする。
const JOURNAL_ATTENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

// docs/em_human_story_and_ux.md P0-3対応。「様子見」に決めたまま長期間放置されている
// 項目は、判断待ちレーンへ再浮上させる。
const WATCH_RESURFACE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// docs/em_human_story_and_ux.md P1-10対応。進行中（未アーカイブ）の介入のうち、着手は
// されているのに長期間動きが無いものは「やりっぱなし」になりやすい。観測不足として
// 朝キューに載せる（着手前の空のIssueは「Issue未整理」側で既に拾っているため対象外）。
const STALE_INTERVENTION_MS = 14 * 24 * 60 * 60 * 1000;

// docs/em_human_story_and_ux.md P0-4対応。並列consult(M)や自動検知の連続起動で、AIの
// 未確認ドラフトが一度に大量発生すると、本当の判断待ち（Yield/エラー/無応答）が
// 埋もれる。同種のドラフトが閾値を超えたら個別表示をやめ、1件のまとめ表示にする
// （クリック先は相談履歴一覧。個別に見たい場合はそちらから辿れる）。
const AUTO_DRAFT_BUNDLE_THRESHOLD = 3;

export type ExecutionMove = {
  issueId: string;
  issueTitle: string;
  priority: IssuePriority;
  itemId: string;
  itemText: string;
  blocked: boolean;
  updatedAt: number;
};

// Action Items進行管理: 進行中・Waiting の介入。parked は朝の実行キュー外。
// 「次の一手」本体は判断レーンに混ぜず、実行モード専用リストへ載せる。
export function buildExecutionMoves(issues: Issue[]): ExecutionMove[] {
  const activeInterventions = issues
    .filter(
      (i) =>
        !i.archived &&
        !i.parentId &&
        (i.status === "in_progress" || i.status === "blocked") &&
        (i.priority ?? "normal") !== "parked",
    )
    .sort(compareIssuesByPriority);
  return activeInterventions.flatMap((issue) => {
    const next = issueNextAction(issue);
    if (!next) return [];
    return [
      {
        issueId: issue.id,
        issueTitle: issue.title,
        priority: (issue.priority ?? "normal") as IssuePriority,
        itemId: next.id,
        itemText: next.text,
        blocked: issue.status === "blocked",
        updatedAt: issue.updatedAt,
      },
    ];
  });
}

// docs/em_human_story_and_ux.md P0-3対応。「様子見」のまま一定期間が過ぎたrunは
// 判断待ちレーンへ再浮上させ、「様子見＝忘れられる」にしない。期限内のものは
// watchingItemsとして別途一覧できるようにする（新画面は増やさない）。
export function selectWatchingItems(runs: AgentRun[], issues: Issue[]): AgentRun[] {
  return runs.filter((r) => r.triageStatus === "watching" && !shouldOmitRunFromNextActions(r, issues));
}

export type BuildNextActionsParams = {
  now: number;
  runs: AgentRun[];
  issues: Issue[];
  journalEntries: JournalEntry[];
  people: PersonSummary[];
  vitals: OrgVitals;
  pendingAgentStarts: PendingAgentStart[];
  pendingUnmaskedSends: PendingUnmaskedSend[];
  staleRunIds: Set<string>;
  watchingItems: AgentRun[];
  goToRunIssue: (run: AgentRun) => void;
  push: (path: string) => void;
  prefillJournal: (text: string) => void;
  onConfirmUnmasked: (pending: PendingUnmaskedSend) => void;
};

export function buildNextActions(params: BuildNextActionsParams): NextAction[] {
  const {
    now,
    runs,
    issues,
    journalEntries,
    people,
    vitals,
    pendingAgentStarts,
    pendingUnmaskedSends,
    staleRunIds,
    watchingItems,
    goToRunIssue,
    push,
    prefillJournal,
    onConfirmUnmasked,
  } = params;

  const nextActions: NextAction[] = [];

  for (const run of runs) {
    // docs/usage_issues U4/U5。consult子run・却下済み・アーカイブ済みIssueに紐づくrunは出さない。
    if (shouldOmitRunFromNextActions(run, issues)) continue;
    if (run.triageStatus === "watching") continue;

    // AI主導（イベント駆動・バッチ駆動）で自動起動されたrunは、EMがまだ内容を確認して
    // いない間は「ドラフトIssue（起票待ち）」としてここに残す。クリック先は即Issue化せず
    // /chat（起票／様子見／却下）へ。Issue更新分析だけは紐付くIssue Workspaceへ。
    const isDraft = isDraftAwaitingTriage(run);
    const onSelectDraft = () => {
      if (run.origin === "auto-issue-update") {
        const linked = issues.find((i) => i.agentRunId === run.id);
        if (linked) {
          push(`/issues/${linked.id}`);
          return;
        }
      }
      push(`/chat?runId=${run.id}`);
    };
    // docs/em_human_story_and_ux.md P0-2対応（修正）。自動検知draftsだけでなく、
    // まだIssueに紐付いていないLead Agent run全般も、クリックしたらgoToRunIssueで
    // 即Issue化せず/chatへ寄せる。
    const isLeadUnlinked = run.agentName === "Lead Agent" && !issues.some((i) => i.agentRunId === run.id);

    if (staleRunIds.has(run.id)) {
      const minutes = Math.round((now - run.updatedAt) / 60000);
      nextActions.push({
        id: `stale-${run.id}`,
        severity: "urgent",
        lane: "decision",
        icon: "❔",
        kindLabel: isDraft ? draftKindLabel(run) : "実行異常",
        text: `${run.agentName}が${minutes}分応答していません（動いているように見えて止まっている可能性）: ${run.task.slice(0, 30)}`,
        onSelect: isDraft || isLeadUnlinked ? onSelectDraft : () => goToRunIssue(run),
        since: run.updatedAt,
        ctaLabel: "確認する",
      });
    } else if (run.status === "yield") {
      nextActions.push({
        id: `yield-${run.id}`,
        severity: "urgent",
        lane: "decision",
        icon: "🟡",
        kindLabel: isDraft ? draftKindLabel(run) : `Yield · ${run.agentName}`,
        text: `${isDraft ? "ドラフト: " : ""}${(run.yieldRequest?.reason ?? run.task).slice(0, 44)}`,
        onSelect: isDraft || isLeadUnlinked ? onSelectDraft : () => goToRunIssue(run),
        since: run.updatedAt,
        ctaLabel: "判断する",
      });
    } else if (run.status === "error") {
      nextActions.push({
        id: `error-${run.id}`,
        severity: "urgent",
        lane: "decision",
        icon: "🔴",
        kindLabel: isDraft ? draftKindLabel(run) : "実行異常",
        text: `${isDraft ? "ドラフト（エラー）: " : `${run.agentName}でエラーが発生しました: `}${run.task.slice(0, 44)}`,
        onSelect: isDraft || isLeadUnlinked ? onSelectDraft : () => goToRunIssue(run),
        since: run.updatedAt,
        ctaLabel: "確認する",
      });
    } else if (isDraft && (run.status === "active" || run.status === "queued")) {
      // 分析中もヒーローから消えないようにする（「進んでいるのか見えにくい」対策）。
      nextActions.push({
        id: `auto-${run.id}`,
        severity: "warn",
        lane: "decision",
        icon: "⏳",
        kindLabel: draftKindLabel(run),
        text: `分析中: ${run.task.slice(0, 44)}`,
        onSelect: onSelectDraft,
        since: run.updatedAt,
        ctaLabel: "進捗を見る",
      });
    } else if (isDraft && run.status === "idle") {
      // 自律の出口＝起票待ちドラフト。本文は proposal.conclusion を優先。
      nextActions.push({
        id: `auto-${run.id}`,
        severity: "warn",
        lane: "decision",
        icon: "🤖",
        kindLabel: draftKindLabel(run),
        text: run.proposal?.conclusion
          ? run.proposal.conclusion.slice(0, 60)
          : `${runKindLabel(run)}: ${run.task.slice(0, 44)}`,
        onSelect: onSelectDraft,
        since: run.updatedAt,
        ctaLabel: "起票／却下する",
      });
    }
  }

  for (const entry of journalEntries) {
    if (now - entry.createdAt > JOURNAL_ATTENTION_WINDOW_MS) continue;
    if (entry.urgency === "mid" && entry.sentiment === "negative") {
      nextActions.push({
        id: `journal-${entry.id}`,
        severity: "warn",
        lane: "observation",
        icon: "📝",
        kindLabel: "要注目Journal",
        text: (entry.summary || entry.rawText).slice(0, 44),
        onSelect: () =>
          push(
            `/chat?prefill=${encodeURIComponent(`${entry.rawText}について、対応方針を相談したい`)}&journalId=${encodeURIComponent(entry.id)}`,
          ),
        since: entry.createdAt,
      });
    } else if (entry.urgency === "high" && !entry.confirmed) {
      // docs/em_human_story_and_ux.md P1-9対応。緊急度highの自動検知はEMの校正後にしか
      // 起動しないため、校正されないまま放置されると誰にも気づかれない恐れがある。
      // 未確認のままのhighエントリは、様子見にできる「観測不足」ではなく「判断待ち」
      // （校正するかどうかを決める）として明示的に残す。
      // 改修依頼「/journalへ放り込むだけで、その先どうすればいいか分からない」対応。
      // /journal?focus=<id>で該当エントリのページへ直接移動し、編集モードまで自動的に
      // 開く（EMは内容を確認して「この内容で確定」を押すだけで完結する）。
      nextActions.push({
        id: `journal-unconfirmed-${entry.id}`,
        severity: "urgent",
        lane: "decision",
        icon: "📝",
        kindLabel: "Journal未確認",
        text: `内容を確認して「この内容で確定」してください（緊急度high・未確認）: ${(entry.summary || entry.rawText).slice(0, 36)}`,
        onSelect: () => push(`/journal?focus=${entry.id}`),
        since: entry.createdAt,
      });
    }
  }

  for (const issue of issues) {
    if (!issueNeedsCharter(issue)) continue;
    nextActions.push({
      id: `charter-${issue.id}`,
      severity: "warn",
      lane: "maintenance",
      icon: "❓",
      kindLabel: "Issue未整理",
      text: `Issue「${issue.title}」のWhy/What/Howが${charterFilledCount(issue.charter)}/3しか整理されていません`,
      onSelect: () => push(`/issues/${issue.id}`),
      since: issue.updatedAt,
    });
  }

  // docs/em_human_story_and_ux.md P1-10対応。要注目人物（ネガティブ傾向が優勢）を
  // 朝キューにも薄く載せる（Peopleハブは「ある画面」のままだと朝の物語に編入されないため）。
  const attentionPeople = people
    .filter((p) => p.trend.negative >= 2 && p.trend.negative > p.trend.positive)
    .sort((a, b) => b.trend.negative - a.trend.negative)
    .slice(0, 3);
  for (const p of attentionPeople) {
    nextActions.push({
      id: `person-${p.id}`,
      severity: "warn",
      lane: "observation",
      icon: "🧑",
      kindLabel: "要注目人物",
      text: `${p.name}: ネガティブな傾向のFactが${p.trend.negative}件あります`,
      onSelect: () => push(`/people/${p.id}`),
      // Person集計に個別のタイムスタンプが無いため「新着」判定はしない（0固定）。
      since: 0,
    });
  }

  const staleInterventions = issues
    .filter(
      (i) =>
        !i.archived &&
        !i.parentId &&
        (charterFilledCount(i.charter) > 0 || i.actionItems.length > 0) &&
        now - i.updatedAt > STALE_INTERVENTION_MS,
    )
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, 3);
  for (const issue of staleInterventions) {
    const days = Math.round((now - issue.updatedAt) / (24 * 60 * 60 * 1000));
    nextActions.push({
      id: `stale-issue-${issue.id}`,
      severity: "warn",
      lane: "observation",
      icon: "🧊",
      kindLabel: "介入の観測不足",
      text: `「${issue.title}」が${days}日間動いていません。効果を観測しましたか？`,
      onSelect: () => push(`/issues/${issue.id}`),
      // 停滞検知自体が「長期間動きが無いこと」なので、常に新着扱いにはしない。
      since: 0,
    });
  }

  const activeInterventionsForMissingNext = issues.filter(
    (i) =>
      !i.archived &&
      !i.parentId &&
      (i.status === "in_progress" || i.status === "blocked") &&
      (i.priority ?? "normal") !== "parked",
  );
  const missingNext = activeInterventionsForMissingNext
    .filter((i) => !issueNextAction(i) && (i.priority ?? "normal") === "focus")
    .slice(0, INTERVENTION_NEXT_ACTION_LIMIT);
  for (const issue of missingNext) {
    nextActions.push({
      id: `missing-next-${issue.id}`,
      severity: "warn",
      lane: "maintenance",
      icon: "📋",
      kindLabel: "次の一手未設定",
      text: `フォーカス「${issue.title}」の次の一手が未設定です`,
      onSelect: () => push(`/issues/${issue.id}`),
      since: issue.updatedAt,
    });
  }

  for (const v of vitals.teams) {
    if (v.status === "bad" || v.status === "warn") {
      nextActions.push({
        id: `vital-${v.teamId}`,
        severity: v.status === "bad" ? "urgent" : "warn",
        lane: "decision",
        icon: v.status === "bad" ? "🔴" : "🟡",
        kindLabel: "チームリスク",
        text: `${v.teamName}のチーム状態: ${v.label}`,
        // チーム管理は/teamsへ移設済み。方針・目標(/org)ではなく該当チームを選択した
        // 状態で開けるよう ?focus= を付ける（/journal?focus= と同じパターン）。
        onSelect: () => push(`/teams?focus=${encodeURIComponent(v.teamId)}`),
        // Team Vitalsは実測値の再計算結果であり個別のタイムスタンプを持たないため0固定。
        since: 0,
      });
    } else if (v.status === "unknown") {
      // docs/memo.md「D」対応。診断で止まらせず、観測を増やす行動（Quick Journal）へ誘導する。
      nextActions.push({
        id: `vital-unknown-${v.teamId}`,
        severity: "warn",
        lane: "observation",
        icon: "⚪️",
        kindLabel: "評価不能",
        text: `${v.teamName}は評価不能（情報不足）— 観測を増やす`,
        onSelect: () => prefillJournal(v.members.length > 0 ? `#1on1 @${v.members[0]} ` : ""),
        since: 0,
      });
    }
  }

  if (vitals.oneOnOneCoverage.status === "bad" || vitals.oneOnOneCoverage.status === "warn") {
    nextActions.push({
      id: "coverage",
      severity: vitals.oneOnOneCoverage.status === "bad" ? "urgent" : "warn",
      lane: "observation",
      icon: vitals.oneOnOneCoverage.status === "bad" ? "🔴" : "🟡",
      kindLabel: "1on1不足",
      text: `1on1 Coverageが${vitals.oneOnOneCoverage.covered}/${vitals.oneOnOneCoverage.total}件です`,
      // docs/em_human_story_and_ux.md P1-8対応。「評価不能・1on1不足」は体制変更ではなく
      // 観測を増やす行動（Quick Journal）に一本化する。体制そのものを見直したい場合は
      // Team Vitalsパネル側から/orgへ行ける。
      onSelect: () =>
        prefillJournal(vitals.oneOnOneCoverage.uncoveredMembers[0] ? `#1on1 @${vitals.oneOnOneCoverage.uncoveredMembers[0]} ` : ""),
      since: 0,
    });
  }

  for (const run of watchingItems) {
    const watchedAt = run.triageAt ?? run.updatedAt;
    if (now - watchedAt <= WATCH_RESURFACE_AFTER_MS) continue;
    const days = Math.round((now - watchedAt) / (24 * 60 * 60 * 1000));
    nextActions.push({
      id: `watch-expired-${run.id}`,
      severity: "warn",
      lane: "decision",
      icon: "👀",
      kindLabel: "様子見の期限切れ",
      text: `${days}日前から様子見のままです。再度判断してください: ${run.task.slice(0, 40)}`,
      onSelect: () => push(`/chat?runId=${run.id}`),
      // 期限切れ自体は「以前からの様子見」なので新着扱いにはしない。
      since: 0,
    });
  }

  // デバウンス待ちの自動起動予定。EMが「更新したのに動いていない」と感じないよう、
  // 観測レーンに残り秒数つきで載せる（判断待ちではないので decision には入れない）。
  for (const pending of pendingAgentStarts) {
    nextActions.push({
      id: `pending-start-${pending.id}`,
      severity: "warn",
      lane: "observation",
      icon: "⏳",
      kindLabel: "起動予定",
      text: formatPendingAgentStartText(pending, now),
      onSelect: () => {
        if (pending.issueId) push(`/issues/${pending.issueId}`);
      },
      since: pending.firesAt,
    });
  }

  // 未登録人名候補のまま外部送信してよいかの確認待ち（自動起動が止まった状態）。
  for (const pending of pendingUnmaskedSends) {
    nextActions.push({
      id: `pending-unmasked-${pending.id}`,
      severity: "urgent",
      lane: "decision",
      icon: "🪪",
      kindLabel: "送信前確認",
      text: `${pending.label} — マスクされない候補: ${pending.candidates.map((c) => `「${c}」`).join("、")}`,
      onSelect: () => onConfirmUnmasked(pending),
      since: now,
    });
  }

  const autoDraftIds = new Set(nextActions.filter((a) => a.id.startsWith("auto-")).map((a) => a.id));
  if (autoDraftIds.size > AUTO_DRAFT_BUNDLE_THRESHOLD) {
    for (let i = nextActions.length - 1; i >= 0; i--) {
      if (autoDraftIds.has(nextActions[i].id)) nextActions.splice(i, 1);
    }
    nextActions.push({
      id: "auto-bundle",
      severity: "warn",
      lane: "decision",
      icon: "🤖",
      kindLabel: "ドラフトIssue",
      text: `起票待ちのドラフトが${autoDraftIds.size}件たまっています。相談履歴からまとめて確認してください`,
      onSelect: () => push("/chat"),
      since: 0,
      ctaLabel: "一覧を開く",
    });
  }

  nextActions.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "urgent" ? -1 : 1));

  return nextActions;
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { consultListMetaParts } from "@/components/ConsultHistoryItem";
import { draftKindLabel, isDraftAwaitingTriage, runKindLabel, shouldOmitRunFromNextActions } from "@/components/RunDetail";
import { IdFragmentLink } from "@/components/IdFragmentLink";
import { IdLinkedText } from "@/components/IdLinkedText";
import { JournalEntryCard } from "@/components/JournalEntryCard";
import { formatPendingAgentStartText } from "@/components/PendingAgentStartNotice";
import { NameCandidateConfirmDialog } from "@/components/NameCandidateConfirmDialog";
import { consultListSecondary, consultListTitle, truncateExcerpt } from "@/lib/origin-trace";
import {
  useEmCheckins,
  useGoToRunIssue,
  useIssues,
  useJournal,
  useJournalEditing,
  useObjectives,
  useOrgStrategy,
  usePeople,
  useRuns,
  useSettingsRules,
  useTeams,
  useThemes,
  useVitals,
} from "@/lib/hooks";
import { useNameCandidateConfirm } from "@/lib/useNameCandidateConfirm";
import {
  INTERVENTION_NEXT_ACTION_LIMIT,
  ISSUE_PRIORITY_META,
  charterFilledCount,
  compareIssuesByPriority,
  isJournalEntryResolved,
  isRunStale,
  issueNextAction,
  type Issue,
  type IssuePriority,
  type JournalEntry,
  type PendingUnmaskedSend,
} from "@/lib/types";

const JOURNAL_DASHBOARD_LIMIT = 5;
// 整備レーンの初期表示件数。判断待ち・観測不足は設定（decisionQueueLimit /
// observationQueueLimit）で変えられるが、整備は設定項目が無いため定数で揃える。
const NEXT_ACTIONS_LIMIT = 3;
// 「もっと見る」を押すたびに追加で前面に出す件数。
const LANE_EXPAND_STEP = 3;
// docs/memo.md「C. Journalセンシング→行動」対応。urgency:highは既に自動検知(auto-anomaly)
// で拾われているため、「要注目だが自動起動しない」層（mid＋ネガティブ）を一定期間だけ
// 「次にすべきこと」に載せる。Journalには却下/確認済みの概念が無いため、無期限に残り続けない
// よう表示ウィンドウで自然に外れるようにする。
const JOURNAL_ATTENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

// docs/memo.md TODO「ダッシュボードで『人間のEMが次になにをするべきか？』がすぐに分かり、
// 詳細に遷移できる状態にする」への対応。Yield/Error/Issue charter未整理/Team Vitals不調という
// 既存の4つのシグナルを、EMが今すぐ対応すべき順（urgent→warn）に束ねて1箇所に見せる。
// 「対応不要」も明示できるよう、0件のときは空のリストにする（評価不能に寄せず、単に「無い」と示す）。
// docs/memo.md「A. Inboxを組織リスクのトリアージにする」対応。種別が視覚的に埋もれないよう、
// severity/iconとは別に「これは何のカードか」を示す短いラベルを持たせる。
// docs/em_human_story_and_ux.md P0-1対応。「次にすべきこと」を単一リストのままにせず、
// 性質の異なる3つのレーンに分ける。判断待ち＝EMの決断がボトルネックになっているもの、
// 観測不足＝まだ決断材料が足りず観測を増やすべきもの、整備＝緊急ではないが整えたいもの。
type Lane = "decision" | "observation" | "maintenance";

const LANE_META: Record<Lane, { label: string; hint: string }> = {
  decision: { label: "判断待ち", hint: "EMが今すぐ決めれば前に進むもの" },
  observation: { label: "観測不足", hint: "決断の前に事実を集めたいもの" },
  maintenance: { label: "整備", hint: "急ぎではないが整えたいもの" },
};

type NextAction = {
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
function heroRank(a: NextAction): number {
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

function pickHeroAction(actions: NextAction[]): NextAction | null {
  if (actions.length === 0) return null;
  return [...actions].sort((a, b) => {
    const rd = heroRank(a) - heroRank(b);
    if (rd !== 0) return rd;
    if (a.severity !== b.severity) return a.severity === "urgent" ? -1 : 1;
    return b.since - a.since;
  })[0];
}

// 改修依頼「メモ等の保存前にローカルAIが走る処理を非同期化し、対象のアイテム部分に
// スピナーだけ表示する」対応。POST /api/journal・/api/journal/bulkはローカルモデルの
// 抽出処理を含み数十秒かかることがあるため、Submitボタンでブロックせず、その場に
// 「処理中」のプレースホルダーを1件だけ出して裏で処理する。journalEntries（ポーリングで
// 上書きされうる）とは別のstateで持ち、失敗時は元の入力内容を保持したまま再試行できる
// ようにする。
type PendingJournalDraft = {
  tempId: string;
  label: string;
  error?: string;
  retry?: () => void;
};

// docs/em_human_story_and_ux.md P0-3対応。「様子見」に決めたまま長期間放置されている
// 項目は、判断待ちレーンへ再浮上させる。
const WATCH_RESURFACE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function issueNeedsCharter(issue: Issue): boolean {
  return !issue.parentId && !issue.archived && charterFilledCount(issue.charter) < 3;
}

// docs/memo.md TODO「人間EMからのインプットパターン（始業時・随時・終業時など）を設計して
// ダッシュボードに組み込む」対応。docs/first_impressionが想定する朝/日中/終業時の3フェーズを、
// 新しいデータモデルは増やさず、現在時刻に応じた案内文（軽量なバナー）としてのみ表現する。
// 時刻はクライアント（EMのブラウザ）のローカル時刻を使う。
type DayPhase = "morning" | "midday" | "evening";

function getDayPhase(hour: number): DayPhase {
  if (hour < 11) return "morning";
  if (hour < 17) return "midday";
  return "evening";
}

const DAY_PHASE_GUIDANCE: Record<DayPhase, { icon: string; text: string; cta?: string }> = {
  morning: {
    icon: "🌅",
    text: "朝のチェック: 下の「次の1手」から片づけましょう。",
  },
  midday: {
    icon: "🕐",
    text: "気になる出来事は、その場でメモしておくと後で役立ちます。",
    cta: "メモする",
  },
  evening: {
    icon: "🌆",
    text: "終業前に、今日の出来事をメモにまとめておきましょう。",
    cta: "メモする",
  },
};

export default function DashboardPage() {
  const router = useRouter();
  // レンダー内で複数回Date.now()を呼ぶと呼ぶたびに結果がずれるため、このレンダーでの
  // 「現在時刻」として1回だけ取得し使い回す（経過時間の表示用途であり、他のポーリングで
  // どのみち定期的に再レンダーされるため、1回の取得で十分）。
  const now = Date.now();

  // 改修依頼「以前から変わったことがより分かりやすいUIに」対応。前回このダッシュボードを
  // 開いた時刻をブラウザのlocalStorageに記録し（サーバー側の既読管理は増やさない軽量な
  // 実装）、判断待ちカードのうち根拠の時刻がそれより新しいものにだけ「NEW」を出す。
  // 初回訪問（保存値なし）はnullにし、「全部NEW」という誤った印象を与えない。
  const [lastSeenAt] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem("em-dashboard-last-seen");
      return stored ? Number(stored) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("em-dashboard-last-seen", String(Date.now()));
    } catch {
      // localStorageが使えない環境でも「NEW」表示を諦めるだけで、閲覧自体は妨げない
    }
  }, []);

  const { runs, pendingAgentStarts, pendingUnmaskedSends, runsLoaded, refreshRuns } = useRuns();
  const { issues, issuesLoaded, refreshIssues } = useIssues();
  const goToRunIssue = useGoToRunIssue(issues);
  const { vitals, vitalsLoaded } = useVitals();
  const { journalEntries, setJournalEntries, journalLoaded } = useJournal();
  // 改修依頼「今日の振り返りに、今日記録されていない場合のアラートを出す」対応。
  const { checkins, checkinsLoaded } = useEmCheckins();
  const { rules } = useSettingsRules();
  // docs/memo.md「O. 期初の憲法づくりオンボーディング」対応。
  const { strategy, strategyLoaded } = useOrgStrategy();
  const { teams, teamsLoaded } = useTeams();
  const { objectives, objectivesLoaded } = useObjectives();
  // docs/em_human_story_and_ux.md P1-10対応。People(J)を朝キューにも薄く編入する。
  const { people, peopleLoaded } = usePeople();
  const { themes, refreshThemes } = useThemes();
  // 初回フェッチ完了前の空fallbackを「未設定／0件／対応不要」と誤表示しないためのゲート。
  // SettingsのrulesLoadedと同じ考え方（usePollingのloaded）。
  const setupLoaded = strategyLoaded && teamsLoaded && objectivesLoaded;
  const nextActionsLoaded = runsLoaded && issuesLoaded && vitalsLoaded && journalLoaded && peopleLoaded;

  // docs/memo.md TODO「動いていると思ったら止まっていた、を防ぐ」対応。statusが"active"のまま
  // ログ更新が閾値以上無いrunをクライアント側で判定し、Fleet/Next Actions/Inboxで警告表示する。
  const staleRunIds = new Set(
    runs.filter((r) => isRunStale(r.status, r.updatedAt, rules.agentStaleAfterSeconds)).map((r) => r.id),
  );

  const [journalText, setJournalText] = useState("");
  const [journalError, setJournalError] = useState<string | null>(null);
  // 改修依頼「まとめて記録する仕組み」対応。既定は空（＝今日）。EMが「これは今日の話
  // ではない」と分かっているときだけ明示的に開いて指定する（低頻度の操作を毎回の
  // 入力の手間にしない）。
  const [journalDate, setJournalDate] = useState("");
  const [journalDateOpen, setJournalDateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResultMessage, setBulkResultMessage] = useState<string | null>(null);
  // 改修依頼「ローカルAIの処理を非同期化する」対応。Submit/まとめて記録するの実処理は
  // どちらもこのリストに「処理中」の1件を積んでから裏で走らせる（下記handleJournalSubmit/
  // handleBulkSubmit参照）。
  const [pendingJournalDrafts, setPendingJournalDrafts] = useState<PendingJournalDraft[]>([]);

  // docs/memo.md「C. Journalセンシング→行動」対応。AI抽出（tags/people/urgency）を
  // EMがその場で校正するための編集モード。同時に編集できるのは1件のみ。
  // ロジック自体はJournal一覧画面（/journal）と共有するため@/lib/hooksに切り出してある。
  const journalEditing = useJournalEditing(journalEntries, setJournalEntries);
  const { fetchWithNameConfirm, nameCandidateDialog } = useNameCandidateConfirm();
  const [confirmingUnmasked, setConfirmingUnmasked] = useState<PendingUnmaskedSend | null>(null);
  const [confirmingUnmaskedBusy, setConfirmingUnmaskedBusy] = useState(false);

  // docs/memo.md「H: 永続化データモデルの設計」対応。Quick Journal（一時的なfact）とは
  // 別に、長期的な解釈（interpretation、TTLなし）を記録する口。「Aさんはリーダー志向がある」
  // のような、一時的な感情と混同すべきでない長期プロファイルはこちらに書く。
  const [profilePerson, setProfilePerson] = useState("");
  const [profileText, setProfileText] = useState("");
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  // docs/memo.md TODO「人から『〇〇の指示があった』などをもとにその人の志向性、認知傾向、
  // パーソナリティを整理する」対応。新規の推論ロジックは作らず、People Agentに
  // 「この人物についてこれまでのファクトから傾向を整理して」という通常のタスクを投げるだけ。
  // タスク文に対象者の名前が含まれることで、既存のbuildJournalContextBlock（完全一致＋
  // 意味的検索）がその人物のファクト・既存の解釈を自動的に注入してくれる。
  // 結果はあくまで下書きとして長期プロファイルの入力欄に流し込み、EMが確認・編集して
  // 「記録」を押すまでは保存しない（＝観測事実からの推測であることを常に人が確認する）。
  const [draftRunId, setDraftRunId] = useState<string | null>(null);
  const [consumedDraftRunId, setConsumedDraftRunId] = useState<string | null>(null);
  const [draftStarting, setDraftStarting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const draftRun = draftRunId ? runs.find((r) => r.id === draftRunId) ?? null : null;
  const draftRunBusy = draftRun?.status === "active" || draftRun?.status === "queued";
  if (
    draftRun &&
    draftRunId &&
    draftRunId !== consumedDraftRunId &&
    draftRun.status !== "active" &&
    draftRun.status !== "queued"
  ) {
    setConsumedDraftRunId(draftRunId);
    if (draftRun.status === "idle") {
      setProfileText(draftRun.proposal?.conclusion ?? "");
    } else {
      setDraftError(
        draftRun.status === "yield"
          ? "AIから追加の確認が必要という応答がありました。「何でも相談」から続きを確認してください。"
          : "下書きの生成中にエラーが発生しました。「何でも相談」からログを確認してください。",
      );
    }
  }

  async function handleDraftProfile() {
    if (!profilePerson.trim()) return;
    setDraftStarting(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: "People Agent",
          task: `${profilePerson}について、これまで観測されたJournalのファクト・既存の解釈をもとに、志向性・認知傾向・パーソナリティの傾向を2〜3文程度で整理してください。断定は避け、あくまで観測された事実からの推測であることを明記してください。`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "下書きの生成に失敗しました");
      setDraftRunId(data.run.id);
      setConsumedDraftRunId(null);
      await refreshRuns();
    } catch (err) {
      setDraftError((err as Error).message);
    } finally {
      setDraftStarting(false);
    }
  }

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profilePerson.trim() || !profileText.trim()) return;
    setProfileSubmitting(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      const res = await fetch("/api/knowledge/interpretations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: profilePerson, text: profileText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "記録に失敗しました");
      setProfileText("");
      setProfileSaved(true);
    } catch (err) {
      setProfileError((err as Error).message);
    } finally {
      setProfileSubmitting(false);
    }
  }

  const [openVitalId, setOpenVitalId] = useState<string | null>(null);

  // docs/em_human_story_and_ux.md P0-1対応。既定は「判断待ち」だけを見せ、他レーンは
  // タブで切り替える（3種類を同じリストに混在させない）。
  const [laneFilter, setLaneFilter] = useState<Lane>("decision");
  // 次の1手を「判断」（Yield等）と「実行」（Action Itemの次の一手）に分ける。
  const [handMode, setHandMode] = useState<"decide" | "execute">("decide");
  const [completingActionKey, setCompletingActionKey] = useState<string | null>(null);
  // レーンごとの「もっと見る」で追加表示した件数。初期上限（設定 or NEXT_ACTIONS_LIMIT）
  // を超えた分だけをここに積む。タブ切替後もレーン別に覚える。
  const [laneExtraVisible, setLaneExtraVisible] = useState<Record<Lane, number>>({
    decision: 0,
    observation: 0,
    maintenance: 0,
  });
  const [executeExtraVisible, setExecuteExtraVisible] = useState(0);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  // docs/dashboard_ui_readability.md U4-1対応。Quick Journalと長期プロファイルが
  // 同一パネル内で「入力が2種類」に見えないよう、長期プロファイルは既定で畳んでおく。
  const [profileOpen, setProfileOpen] = useState(false);
  const [distillSubmitting, setDistillSubmitting] = useState(false);
  const [distillError, setDistillError] = useState<string | null>(null);
  // 採用済みテーマは「次の1手」ではなく「現在の優先テーマ」。詳細は既定で畳む。
  const [priorityThemeExpandedId, setPriorityThemeExpandedId] = useState<string | null>(null);
  const [priorityThemesShowAll, setPriorityThemesShowAll] = useState(false);
  const [themeEditId, setThemeEditId] = useState<string | null>(null);
  const [themeEditDraft, setThemeEditDraft] = useState({ title: "", summary: "", rationale: "" });
  const [themeEditBusy, setThemeEditBusy] = useState(false);

  // docs/memo.md TODO「ダッシュボードトップでは直近５件程度にとどめつつ、Quick Journalを
  // リスト確認・検索できる画面を追加する」対応。トップでは全件ページネーションはせず、
  // 直近5件だけを見せ、全件の検索・絞り込みは/journalに委ねる。
  // ユーザー指摘「メモするについても解決済みをフィルタできるようにしたい。ただしメモは
  // 解決済みでもデフォルトは表示としたい」対応。/journalのexcludeResolvedと判定基準
  // （isJournalEntryResolved）を揃えるが、却下runとは異なりデフォルトはfalse（＝表示）にする。
  const [excludeResolvedJournal, setExcludeResolvedJournal] = useState(false);
  const visibleJournalEntries = excludeResolvedJournal
    ? journalEntries.filter((e) => !isJournalEntryResolved(e))
    : journalEntries;
  const recentJournalEntries = visibleJournalEntries.slice(0, JOURNAL_DASHBOARD_LIMIT);

  // 改修依頼「メモ等の保存前にローカルAIが走る処理を非同期化する」対応。POST /api/journalは
  // ローカルモデルでの抽出（数十秒かかることがある）を含むため、fetchの完了をSubmitボタンで
  // 待たせない。入力欄は即座にクリアして次の入力を続けられるようにし、処理中は
  // pendingJournalDraftsに積んだプレースホルダー（スピナー表示）だけで進行を示す。
  // 完了後は「AI抽出のまま組織の事実になる」ことを避けるため校正を促したいところだが、
  // Submitからかなり時間が経ってからEMの意図しないタイミングで編集モードを強制的に
  // 開くと混乱を招くため、自動では開かない（🤖未確認バッジ・Journal未確認キューに委ねる）。
  function submitJournalDraft(text: string, occurredAtDate: string | undefined) {
    const tempId = crypto.randomUUID();
    const draft: PendingJournalDraft = { tempId, label: text };
    setPendingJournalDrafts((prev) => [draft, ...prev]);

    (async () => {
      try {
        const { res, data } = await fetchWithNameConfirm(
          "/api/journal",
          { method: "POST", body: { text, occurredAtDate } },
          "保存する",
        );
        if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "タグ付けに失敗しました");
        setJournalEntries((prev) => [(data as { entry: JournalEntry }).entry, ...prev]);
        setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
      } catch (err) {
        if ((err as Error).message === "人名候補の確認をキャンセルしました") {
          setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
          return;
        }
        setPendingJournalDrafts((prev) =>
          prev.map((d) =>
            d.tempId === tempId
              ? { ...d, error: (err as Error).message, retry: () => submitJournalDraft(text, occurredAtDate) }
              : d,
          ),
        );
      }
    })();
  }

  function handleJournalSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = journalText.trim();
    if (!text) return;
    submitJournalDraft(text, journalDate || undefined);
    setJournalText("");
    setJournalDate("");
    setJournalDateOpen(false);
    setJournalError(null);
  }

  // 改修依頼「まとめて記録する仕組み」対応。EMが忙しくて後からまとめて書く場合に、
  // 1件ずつSubmitさせる負担を無くす。まとめ投入した時刻を全件の発生日にはしない
  // （危険）——サーバー側で行ごとに解決した「出来事があった日」をそのまま使う。
  // 結果は他の未確認エントリと同じくJournal一覧にそのまま並び、個別に校正できる。
  // 改修依頼「ローカルAIの処理を非同期化する」対応。行数分ローカルモデルを繰り返し
  // 呼ぶため単発Submitより時間がかかりやすく、同じくブロックしない非同期処理にする。
  function submitBulkDraft(text: string) {
    const tempId = crypto.randomUUID();
    const lineCount = text.split("\n").map((l) => l.trim()).filter(Boolean).length;
    const draft: PendingJournalDraft = { tempId, label: `まとめて記録中…（${lineCount}行）` };
    setPendingJournalDrafts((prev) => [draft, ...prev]);

    (async () => {
      try {
        const { res, data } = await fetchWithNameConfirm(
          "/api/journal/bulk",
          { method: "POST", body: { text } },
          "保存する",
        );
        if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? "まとめ記録に失敗しました");
        const newEntries = (data as { entries: JournalEntry[]; skippedLines: number }).entries;
        setJournalEntries((prev) => [...newEntries, ...prev]);
        setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
        setBulkResultMessage(
          `${newEntries.length}件を記録しました（いずれも未確認）。内容と発生日を確認してください。${
            (data as { skippedLines: number }).skippedLines > 0
              ? ` ※${(data as { skippedLines: number }).skippedLines}行は上限を超えたため処理していません。`
              : ""
          }`,
        );
      } catch (err) {
        if ((err as Error).message === "人名候補の確認をキャンセルしました") {
          setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
          return;
        }
        setPendingJournalDrafts((prev) =>
          prev.map((d) => (d.tempId === tempId ? { ...d, error: (err as Error).message, retry: () => submitBulkDraft(text) } : d)),
        );
      }
    })();
  }

  function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = bulkText.trim();
    if (!text) return;
    setBulkError(null);
    setBulkResultMessage(null);
    submitBulkDraft(text);
    setBulkText("");
  }

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
          router.push(`/issues/${linked.id}`);
          return;
        }
      }
      router.push(`/chat?runId=${run.id}`);
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
          router.push(
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
        onSelect: () => router.push(`/journal?focus=${entry.id}`),
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
      onSelect: () => router.push(`/issues/${issue.id}`),
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
      onSelect: () => router.push(`/people/${p.id}`),
      // Person集計に個別のタイムスタンプが無いため「新着」判定はしない（0固定）。
      since: 0,
    });
  }

  // docs/em_human_story_and_ux.md P1-10対応。進行中（未アーカイブ）の介入のうち、着手は
  // されているのに長期間動きが無いものは「やりっぱなし」になりやすい。観測不足として
  // 朝キューに載せる（着手前の空のIssueは「Issue未整理」側で既に拾っているため対象外）。
  const STALE_INTERVENTION_MS = 14 * 24 * 60 * 60 * 1000;
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
      onSelect: () => router.push(`/issues/${issue.id}`),
      // 停滞検知自体が「長期間動きが無いこと」なので、常に新着扱いにはしない。
      since: 0,
    });
  }

  // Action Items進行管理: 進行中・Waiting の介入。parked は朝の実行キュー外。
  // 「次の一手」本体は判断レーンに混ぜず、実行モード専用リストへ載せる。
  const activeInterventions = issues
    .filter(
      (i) =>
        !i.archived &&
        !i.parentId &&
        (i.status === "in_progress" || i.status === "blocked") &&
        (i.priority ?? "normal") !== "parked",
    )
    .sort(compareIssuesByPriority);
  const executionMoves = activeInterventions.flatMap((issue) => {
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
  const missingNext = activeInterventions
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
      onSelect: () => router.push(`/issues/${issue.id}`),
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
        onSelect: () => router.push("/org"),
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

  // docs/em_human_story_and_ux.md P0-3対応。「様子見」のまま一定期間が過ぎたrunは
  // 判断待ちレーンへ再浮上させ、「様子見＝忘れられる」にしない。期限内のものは
  // watchingItemsとして別途一覧できるようにする（新画面は増やさない）。
  const watchingItems = runs.filter(
    (r) => r.triageStatus === "watching" && !shouldOmitRunFromNextActions(r, issues),
  );
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
      onSelect: () => router.push(`/chat?runId=${run.id}`),
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
        if (pending.issueId) router.push(`/issues/${pending.issueId}`);
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
      onSelect: () => setConfirmingUnmasked(pending),
      since: now,
    });
  }

  // docs/em_human_story_and_ux.md P0-4対応。並列consult(M)や自動検知の連続起動で、AIの
  // 未確認ドラフトが一度に大量発生すると、本当の判断待ち（Yield/エラー/無応答）が
  // 埋もれる。同種のドラフトが閾値を超えたら個別表示をやめ、1件のまとめ表示にする
  // （クリック先は相談履歴一覧。個別に見たい場合はそちらから辿れる）。
  const AUTO_DRAFT_BUNDLE_THRESHOLD = 3;
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
      onSelect: () => router.push("/chat"),
      since: 0,
      ctaLabel: "一覧を開く",
    });
  }

  nextActions.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "urgent" ? -1 : 1));

  // docs/em_human_story_and_ux.md P0-4対応。「1日の上限感」をUIで示す（ハード制限はせず、
  // 今日どれだけAIが自動的にRunを起動したかの感覚をEMに持たせる）。
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const autoRunsToday = runs.filter((r) => r.origin !== "manual" && r.createdAt >= todayStart.getTime()).length;

  // 改修依頼「今日の振り返りは、今日記録されていない場合のアラート表示とEMの成長への
  // リンクのみ置く」対応。入力フォーム自体はここには置かず、未記録のときだけ気づかせて
  // /growthへ誘導する（記録は/growthに一本化）。
  const hasCheckinToday = checkins.some((c) => c.createdAt >= todayStart.getTime());

  // docs/em_human_story_and_ux.md P1-10対応。戦略（H）を「ある画面」から朝の要約へ薄く載せる。
  // 判断待ちの項目ではなく単なる現況表示なので、次にすべきことのリストではなくヘッダー直下の
  // 1行として出す。
  const krTotals = objectives
    .flatMap((o) => o.progress)
    .reduce((acc, p) => ({ done: acc.done + p.done, total: acc.total + p.total }), { done: 0, total: 0 });

  const dayPhase = getDayPhase(new Date(now).getHours());
  const guidance = DAY_PHASE_GUIDANCE[dayPhase];

  function focusJournalInput() {
    const el = document.getElementById("quick-journal-input");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLInputElement | null)?.focus();
  }

  // docs/memo.md「D. 評価不能→観測アクション」対応。評価不能で立ち止まらせず、
  // 「誰の1on1を記録すればよいか」までQuick Journalへのプリフィルで橋渡しする。
  function prefillJournal(text: string) {
    setJournalText(text);
    focusJournalInput();
  }

  // docs/memo.md「O. 期初の憲法づくりオンボーディング」対応。空の前提のままエージェントが
  // 走らないよう、MVV/Team/Objectiveが揃うまでセットアップ導線を出す。新規ウィザード画面は
  // 増やさず、既存の/orgへの案内に留める（EMが明示的に消せるものではなく、実際に揃うと
  // 自然に消える）。未ロード中は空fallbackを「未設定」と誤認しないよう計算しない。
  const setupGaps: string[] = [];
  if (setupLoaded) {
    if (!strategy.mission && !strategy.vision && !strategy.values) setupGaps.push("MVV未設定");
    if (teams.length === 0) setupGaps.push(`Team ${teams.length}件`);
    if (objectives.length === 0) setupGaps.push(`Objective ${objectives.length}件`);
  }

  // docs/em_human_story_and_ux.md P0-5対応。先頭を「今日の組織の問い」1文へ圧縮する。
  // docs/em_ui_ux_issue.md 2.2/4節「AI主導トリアージ・上限N件への圧縮」対応。レーンごとに
  // 初期上限を分ける。超過分は非表示にせず、「もっと見る」で +LANE_EXPAND_STEP 件ずつ
  // 同じリストに追加表示する（情報を失わない）。
  const LANE_LIMITS: Record<Lane, number> = {
    decision: rules.decisionQueueLimit,
    observation: rules.observationQueueLimit,
    maintenance: NEXT_ACTIONS_LIMIT,
  };
  const heroAction = pickHeroAction(nextActions);
  const restActions = heroAction ? nextActions.filter((a) => a.id !== heroAction.id) : nextActions;
  const restLaneCounts: Record<Lane, number> = { decision: 0, observation: 0, maintenance: 0 };
  for (const a of restActions) restLaneCounts[a.lane]++;
  const laneActionsForFilter = restActions.filter((a) => a.lane === laneFilter);
  const laneLimit = LANE_LIMITS[laneFilter] + laneExtraVisible[laneFilter];
  const visibleActions = laneActionsForFilter.slice(0, laneLimit);
  const hiddenActionCount = Math.max(0, laneActionsForFilter.length - laneLimit);
  const executeLimit = INTERVENTION_NEXT_ACTION_LIMIT + executeExtraVisible;
  const visibleExecutionMoves = executionMoves.slice(0, executeLimit);
  const hiddenExecutionCount = Math.max(0, executionMoves.length - executeLimit);
  // 未ロード中は「課題はありません」と断定しない（空fallbackを実データと誤認させない）。
  const headline = !nextActionsLoaded
    ? "読み込み中…"
    : handMode === "execute"
      ? "進める次の一手"
      : heroAction
        ? "次の1手"
        : "✅ 今日、判断待ちの組織課題はありません。";
  const restCount = restActions.length;

  // 採用＝肯定（1段階）。壁打ち前提に入ったテーマを「意識の錨」として今日タブに残す。
  const PRIORITY_THEME_LIMIT = 3;
  const adoptedThemes = themes
    .filter((t) => t.status === "adopted")
    .sort((a, b) => (b.adoptedAt ?? b.updatedAt) - (a.adoptedAt ?? a.updatedAt));
  const visiblePriorityThemes = priorityThemesShowAll
    ? adoptedThemes
    : adoptedThemes.slice(0, PRIORITY_THEME_LIMIT);
  const hiddenPriorityThemeCount = Math.max(0, adoptedThemes.length - PRIORITY_THEME_LIMIT);

  async function handleCompleteExecutionMove(issueId: string, itemId: string) {
    const key = `${issueId}:${itemId}`;
    setCompletingActionKey(key);
    try {
      const res = await fetch(`/api/issues/${issueId}/action-items/${itemId}`, { method: "PATCH" });
      if (res.ok) await refreshIssues();
    } finally {
      setCompletingActionKey(null);
    }
  }

  return (
    <div className={styles.screen}>
      {setupGaps.length > 0 && (
        <div
          className={styles.panel}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 16px",
            background: "var(--yellow-bg)",
            border: "1px solid var(--yellow-border)",
          }}
        >
          <span style={{ fontSize: "0.8125rem" }}>⚙️ 初回セットアップ: {setupGaps.join("・")}</span>
          {/* ユーザー要望「チーム・メンバータブにチームの追加・編集を統合したい」対応。チームの
              追加は/teams（チーム・メンバータブの「チーム」）へ、MVV/Objectiveの設定は
              方針・目標タブへ、と行き先が分かれたためボタンも分ける（不足している方だけ出す）。 */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {teams.length === 0 && (
              <button className={styles.btnOutline} onClick={() => router.push("/teams")}>
                チームへ
              </button>
            )}
            {(!strategy.mission && !strategy.vision && !strategy.values) || objectives.length === 0 ? (
              <button className={styles.btnOutline} onClick={() => router.push("/org")}>
                方針・目標へ
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div
        className={styles.panel}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 16px" }}
      >
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {guidance.icon} {guidance.text}
        </span>
        {guidance.cta && (
          <button className={styles.btnOutline} style={{ flexShrink: 0 }} onClick={focusJournalInput}>
            {guidance.cta}
          </button>
        )}
      </div>

      {/* docs/em_ui_ux_issue.md 3節「Evening Mode」対応。終業時だけ、記録し忘れへの気づきと
          記録先（/growth）への導線のみを置く。入力フォーム自体はここには置かない
          （改修依頼「今日記録されていない場合のアラート表示とEMの成長へのリンクのみ」対応）。 */}
      {dayPhase === "evening" && (
        <div className={styles.panel}>
          <h2>今日の振り返り</h2>
          {!checkinsLoaded ? (
            <p className={styles.subtitle}>読み込み中…</p>
          ) : (
            !hasCheckinToday && (
              <div className={styles.charterWarnBanner}>
                ⚠️ まだ今日のチェックイン（気分・エネルギー・ストレス）を記録していません。
              </div>
            )
          )}
          <button className={styles.btnOutline} onClick={() => router.push("/growth")}>
            EMの成長へ →
          </button>
        </div>
      )}

      {/* 採用済みテーマは判断待ちではなく「いまの見立て」。次の1手の直前に意識の錨として置く。 */}
      {adoptedThemes.length > 0 && (
        <div className={styles.panel} style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: "1rem" }}>現在の優先テーマ</h2>
          <p className={styles.subtitle} style={{ marginTop: 4 }}>
            Issue壁打ちの前提として使われています。問題なければ操作は不要です。
          </p>
          {visiblePriorityThemes.map((t) => {
            const expanded = priorityThemeExpandedId === t.id || themeEditId === t.id;
            return (
              <div
                key={t.id}
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid var(--border)",
                  fontSize: "0.8125rem",
                }}
              >
                {themeEditId === t.id ? (
                  <div className={styles.field}>
                    <label>
                      タイトル
                      <input
                        value={themeEditDraft.title}
                        onChange={(e) => setThemeEditDraft({ ...themeEditDraft, title: e.target.value })}
                      />
                    </label>
                    <label>
                      根本課題の見立て
                      <textarea
                        rows={2}
                        value={themeEditDraft.summary}
                        onChange={(e) => setThemeEditDraft({ ...themeEditDraft, summary: e.target.value })}
                      />
                    </label>
                    <label>
                      なぜこの結果に至ったか
                      <textarea
                        rows={3}
                        value={themeEditDraft.rationale}
                        onChange={(e) => setThemeEditDraft({ ...themeEditDraft, rationale: e.target.value })}
                      />
                    </label>
                    <div className={styles.yieldActions}>
                      <button
                        className={styles.primaryBtn}
                        style={{ width: "auto" }}
                        disabled={
                          themeEditBusy ||
                          (themeEditDraft.title === t.title &&
                            themeEditDraft.summary === t.summary &&
                            themeEditDraft.rationale === t.rationale)
                        }
                        onClick={async () => {
                          setThemeEditBusy(true);
                          try {
                            const res = await fetch(`/api/themes/${t.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "revise", ...themeEditDraft }),
                            });
                            if (!res.ok) throw new Error("更新に失敗しました");
                            setThemeEditId(null);
                            await refreshThemes();
                          } finally {
                            setThemeEditBusy(false);
                          }
                        }}
                      >
                        保存
                      </button>
                      <button className={styles.btnOutline} onClick={() => setThemeEditId(null)}>
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong>{t.title}</strong>
                        <p style={{ margin: "2px 0 0", color: "var(--text-muted)" }}>{t.summary}</p>
                      </div>
                      <button
                        className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                        type="button"
                        onClick={() => setPriorityThemeExpandedId(expanded ? null : t.id)}
                      >
                        {expanded ? "閉じる" : "詳細"}
                      </button>
                    </div>
                    {expanded && (
                      <div style={{ marginTop: 8 }}>
                        <p style={{ margin: "0 0 6px", color: "var(--text-muted)", fontSize: "0.75rem" }}>
                          <IdLinkedText text={t.rationale} />
                        </p>
                        {t.facts.length > 0 && (
                          <ul style={{ margin: "0 0 6px 16px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            {t.facts.map((f, i) => (
                              <li key={i}>
                                <IdLinkedText text={f} />
                              </li>
                            ))}
                          </ul>
                        )}
                        {t.rootCause && (
                          <p style={{ margin: "0 0 4px", fontSize: "0.75rem" }}>
                            根本原因: <IdLinkedText text={t.rootCause} />
                          </p>
                        )}
                        {t.suggestedDirection && (
                          <p style={{ margin: "0 0 4px", fontSize: "0.75rem" }}>
                            解決の方向性: <IdLinkedText text={t.suggestedDirection} />
                          </p>
                        )}
                        {(t.evidenceIssueIds.length > 0 || t.evidenceJournalIds.length > 0) && (
                          <div style={{ marginTop: 6, fontSize: "0.75rem" }}>
                            {t.evidenceIssueIds.length > 0 && (
                              <p style={{ margin: "2px 0" }}>
                                <strong>根拠 Issue: </strong>
                                {t.evidenceIssueIds.map((id, ii) => (
                                  <span key={id}>
                                    {ii > 0 ? "、" : ""}
                                    <IdFragmentLink fragment={id} className={styles.idFragmentLink}>
                                      {id.slice(0, 8)}
                                    </IdFragmentLink>
                                  </span>
                                ))}
                              </p>
                            )}
                            {t.evidenceJournalIds.length > 0 && (
                              <p style={{ margin: "2px 0" }}>
                                <strong>根拠 Journal: </strong>
                                {t.evidenceJournalIds.map((id, ii) => (
                                  <span key={id}>
                                    {ii > 0 ? "、" : ""}
                                    <IdFragmentLink fragment={id} className={styles.idFragmentLink}>
                                      {id.slice(0, 8)}
                                    </IdFragmentLink>
                                  </span>
                                ))}
                              </p>
                            )}
                          </div>
                        )}
                        <div className={styles.yieldActions} style={{ marginTop: 8 }}>
                          <button
                            className={styles.btnOutline}
                            type="button"
                            onClick={() => {
                              setThemeEditId(t.id);
                              setThemeEditDraft({ title: t.title, summary: t.summary, rationale: t.rationale });
                            }}
                          >
                            編集して訂正
                          </button>
                          {t.sourceRunId && (
                            <button
                              className={styles.btnOutline}
                              type="button"
                              onClick={() => router.push(`/chat?runId=${t.sourceRunId}`)}
                            >
                              壁打ちで見直す
                            </button>
                          )}
                          <button
                            className={styles.btnOutline}
                            type="button"
                            onClick={async () => {
                              await fetch(`/api/themes/${t.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "dismiss" }),
                              });
                              if (priorityThemeExpandedId === t.id) setPriorityThemeExpandedId(null);
                              await refreshThemes();
                            }}
                          >
                            採用を取り消す
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {hiddenPriorityThemeCount > 0 && (
            <button
              type="button"
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              style={{ marginTop: 10 }}
              onClick={() => setPriorityThemesShowAll(!priorityThemesShowAll)}
            >
              {priorityThemesShowAll
                ? "件数を減らす"
                : `他 ${hiddenPriorityThemeCount} 件の採用テーマを見る`}
            </button>
          )}
        </div>
      )}

      {/* 「次の1手」をヒーローに固定。判断（Yield等）と実行（Next Action）をモードで分ける。 */}
      <div className={styles.dashColumns}>
      <div className={`${styles.panel} ${styles.heroPanel}`}>
        <h2 className={styles.heroHeadline}>{headline}</h2>

        {krTotals.total > 0 && (
          <p className={styles.subtitle} style={{ margin: "0 0 4px" }}>
            📈 今期のKR進捗: {krTotals.done}/{krTotals.total}件
            <button className={styles.detailToggle} style={{ marginLeft: 6 }} onClick={() => router.push("/org")}>
              詳細
            </button>
          </p>
        )}
        {autoRunsToday > 0 && (
          <p className={styles.subtitle} style={{ margin: "0 0 8px" }}>
            🤖 本日のAI自動起動: {autoRunsToday}件（出口は起票待ちドラフト）
            <button className={styles.detailToggle} style={{ marginLeft: 6 }} onClick={() => router.push("/settings")}>
              頻度を調整
            </button>
          </p>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <button
            className={styles.btnOutline}
            disabled={distillSubmitting}
            onClick={async () => {
              setDistillSubmitting(true);
              setDistillError(null);
              try {
                const res = await fetch("/api/themes/distill", { method: "POST" });
                const data = await res.json().catch(() => null);
                if (res.status === 202) {
                  await refreshRuns();
                  return;
                }
                if (!res.ok) throw new Error(data?.error ?? "状況蒸留の起動に失敗しました");
                const runId = data?.run?.id as string | undefined;
                await refreshRuns();
                if (runId) router.push(`/chat?runId=${runId}`);
              } catch (err) {
                setDistillError((err as Error).message);
              } finally {
                setDistillSubmitting(false);
              }
            }}
          >
            {distillSubmitting ? "蒸留を起動中…" : "🧭 状況を蒸留する"}
          </button>
          <span className={styles.subtitle} style={{ margin: 0 }}>
            Journal・Issueから根本課題の見立てを候補化する（採用するまで壁打ち前提には入らない）
          </span>
        </div>
        {distillError && (
          <p className={styles.errorText} role="alert">
            {distillError}
          </p>
        )}

        <div className={styles.tabs} style={{ margin: "0 0 12px" }}>
          <button
            type="button"
            className={`${styles.tabBtn} ${handMode === "decide" ? styles.tabBtnActive : ""}`}
            onClick={() => setHandMode("decide")}
            title="Yield・起票待ち・異常など、人の判断が要るもの"
          >
            判断{nextActionsLoaded ? `（${nextActions.length}）` : ""}
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${handMode === "execute" ? styles.tabBtnActive : ""}`}
            onClick={() => setHandMode("execute")}
            title="介入の次の一手をフォーカス順で進める"
          >
            実行{issuesLoaded ? `（${executionMoves.length}）` : ""}
          </button>
        </div>

        {handMode === "decide" ? (
          <>
            {!nextActionsLoaded ? (
              <p className={styles.subtitle}>読み込み中…</p>
            ) : heroAction ? (
              <div
                className={`${styles.runItem} ${heroAction.severity === "urgent" ? styles.nextActionUrgent : styles.nextActionWarn}`}
                style={{
                  display: "block",
                  padding: "14px 16px",
                  marginBottom: 12,
                  cursor: "pointer",
                  borderWidth: 2,
                }}
                onClick={heroAction.onSelect}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    heroAction.onSelect();
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <span className={styles.badge}>{heroAction.kindLabel}</span>
                  {lastSeenAt !== null && heroAction.since > lastSeenAt && <span className={styles.newBadge}>新着</span>}
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {LANE_META[heroAction.lane].label}
                  </span>
                </div>
                <div className={styles.runItemTask} style={{ fontSize: "1rem", lineHeight: 1.45, marginBottom: 12 }}>
                  {heroAction.icon} {heroAction.text}
                </div>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  style={{ width: "auto" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    heroAction.onSelect();
                  }}
                >
                  {heroAction.ctaLabel ?? "開く"}
                </button>
              </div>
            ) : (
              <p className={styles.subtitle}>✅ 今すぐ決めるべき次の1手はありません。</p>
            )}

            {restCount > 0 && (
              <>
                <p className={styles.subtitle} style={{ margin: "4px 0 8px" }}>
                  他に {restCount} 件（判断待ち{restLaneCounts.decision}・観測{restLaneCounts.observation}・整備{restLaneCounts.maintenance}）
                </p>
                <div className={styles.tabs} style={{ margin: "0 0 10px" }}>
                  {(Object.keys(LANE_META) as Lane[]).map((lane) => (
                    <button
                      key={lane}
                      className={`${styles.tabBtn} ${laneFilter === lane ? styles.tabBtnActive : ""}`}
                      onClick={() => setLaneFilter(lane)}
                      title={LANE_META[lane].hint}
                    >
                      {LANE_META[lane].label}（{restLaneCounts[lane]}）
                    </button>
                  ))}
                </div>
                {visibleActions.length === 0 ? (
                  <p className={styles.subtitle}>このレーンの残りはありません。</p>
                ) : (
                  <>
                    <div className={styles.runList} style={{ maxHeight: "none" }}>
                      {visibleActions.map((a) => (
                        <button
                          key={a.id}
                          className={`${styles.runItem} ${a.severity === "urgent" ? styles.nextActionUrgent : styles.nextActionWarn}`}
                          onClick={a.onSelect}
                        >
                          <span className={styles.badge}>{a.kindLabel}</span>
                          {lastSeenAt !== null && a.since > lastSeenAt && <span className={styles.newBadge}>新着</span>}
                          <div className={styles.runItemTask}>{a.text}</div>
                        </button>
                      ))}
                    </div>
                    {hiddenActionCount > 0 && (
                      <button
                        className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                        style={{ marginTop: 8 }}
                        onClick={() =>
                          setLaneExtraVisible((prev) => ({
                            ...prev,
                            [laneFilter]: prev[laneFilter] + LANE_EXPAND_STEP,
                          }))
                        }
                      >
                        もっと見る（残り{hiddenActionCount}件）
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </>
        ) : !issuesLoaded ? (
          <p className={styles.subtitle}>読み込み中…</p>
        ) : executionMoves.length === 0 ? (
          <p className={styles.subtitle}>✅ 進める次の一手はありません。</p>
        ) : (
          <>
            <p className={styles.subtitle} style={{ margin: "0 0 8px" }}>
              介入の優先度順（フォーカス → 通常）。完了すると次の未完了が繰り上がります。
            </p>
            <div className={styles.runList} style={{ maxHeight: "none" }}>
              {visibleExecutionMoves.map((move) => {
                const key = `${move.issueId}:${move.itemId}`;
                const priorityMeta = ISSUE_PRIORITY_META[move.priority];
                return (
                  <div
                    key={key}
                    className={`${styles.runItem} ${move.blocked ? styles.nextActionUrgent : styles.nextActionWarn}`}
                    style={{ display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left" }}
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      disabled={completingActionKey === key}
                      aria-label={`「${move.itemText}」を完了`}
                      onChange={() => void handleCompleteExecutionMove(move.issueId, move.itemId)}
                      style={{ marginTop: 4, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                        <span className={styles.badge}>
                          {priorityMeta.icon} {priorityMeta.label}
                        </span>
                        {move.blocked && <span className={styles.badge}>Waiting</span>}
                        <button
                          type="button"
                          className={styles.tableRowLink}
                          onClick={() => router.push(`/issues/${move.issueId}`)}
                        >
                          {move.issueTitle}
                        </button>
                      </div>
                      <div className={styles.runItemTask}>{move.itemText}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {hiddenExecutionCount > 0 && (
              <button
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                style={{ marginTop: 8 }}
                onClick={() => setExecuteExtraVisible((n) => n + LANE_EXPAND_STEP)}
              >
                もっと見る（残り{hiddenExecutionCount}件）
              </button>
            )}
          </>
        )}

        {watchingItems.length > 0 && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <button className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={() => setWatchlistOpen(!watchlistOpen)}>
              👀 様子見中（{watchingItems.length}件）{watchlistOpen ? "を隠す" : "を見る"}
            </button>
            {watchlistOpen && (
              <div className={styles.tableWrap} style={{ marginTop: 8 }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>経過</th>
                      <th>内容</th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchingItems.map((run) => {
                      const days = Math.round((now - (run.triageAt ?? run.updatedAt)) / (24 * 60 * 60 * 1000));
                      // 相談履歴(U12)と同じく、定型の指示文ではなく Journal 本文／結論を主役にする。
                      const title = truncateExcerpt(consultListTitle(run), 100);
                      const secondary = consultListSecondary(run);
                      const meta = consultListMetaParts(run, { omitTime: true, omitTriage: true }).join(" · ");
                      return (
                        <tr key={run.id}>
                          <td className={styles.tableMuted}>{days === 0 ? "今日から" : `${days}日前から`}</td>
                          <td>
                            <button className={styles.tableRowLink} onClick={() => router.push(`/chat?runId=${run.id}`)}>
                              {title}
                            </button>
                            {secondary && (
                              <div className={styles.tableMuted} style={{ marginTop: 2, fontSize: "0.75rem" }}>
                                {truncateExcerpt(secondary, 120)}
                              </div>
                            )}
                            {meta && (
                              <div className={styles.tableMuted} style={{ marginTop: 2, fontSize: "0.75rem" }}>
                                {meta}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.panel}>
        <div className={styles.vitalsHead}>
          <div>
            <h2>チームの状態</h2>
            <p className={styles.subtitle}>自分が管理するチームのみ表示します。情報が足りない場合は「評価不能」と表示します。</p>
          </div>
          <div className={styles.vitalsLegend}>
            <span>🟢 安定</span>
            <span>🟡/🔴 要注意・危険</span>
            <span>⚪️ 評価不能（情報不足）</span>
          </div>
        </div>

        <div className={styles.vitalsGrid}>
          {!vitalsLoaded && <p className={styles.subtitle}>読み込み中…</p>}
          {vitalsLoaded && vitals.teams.map((v) => (
            <div key={v.teamId} className={`${styles.vitalCard} ${styles[`vital-${v.status}`]}`}>
              <div className={styles.vitalLabel}>{v.teamName}</div>
              <div className={styles.vitalValue}>
                {v.status === "good" ? "🟢" : v.status === "warn" ? "🟡" : v.status === "bad" ? "🔴" : "⚪️"} {v.label}
              </div>
              <button
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                onClick={() => setOpenVitalId(openVitalId === v.teamId ? null : v.teamId)}
              >
                根拠を見る
              </button>
              {openVitalId === v.teamId && <div className={styles.vitalDetail}>{v.reason}</div>}
              {v.status === "unknown" && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  <button className={styles.btnOutline} onClick={() => prefillJournal("")}>
                    Quick Journalにメモする
                  </button>
                  {/* ユーザー要望「部下以外の人の1on1実施は基本的に扱わない」対応。
                      自分が管理するチーム(managedByEm)でなければこの提案は出さない。 */}
                  {v.managedByEm && v.members.length > 0 && (
                    <button className={styles.btnOutline} onClick={() => prefillJournal(`#1on1 @${v.members[0]} `)}>
                      {v.members[0]}の1on1を記録
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {vitalsLoaded && (
          <div className={`${styles.vitalCard} ${styles[`vital-${vitals.oneOnOneCoverage.status}`]}`}>
            <div className={styles.vitalLabel}>1on1 Coverage (30日)</div>
            <div className={styles.vitalValue}>
              {vitals.oneOnOneCoverage.covered} / {vitals.oneOnOneCoverage.total}
            </div>
            <button
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              onClick={() => setOpenVitalId(openVitalId === "coverage" ? null : "coverage")}
            >
              根拠を見る
            </button>
            {openVitalId === "coverage" && <div className={styles.vitalDetail}>{vitals.oneOnOneCoverage.reason}</div>}
            {(vitals.oneOnOneCoverage.status === "warn" || vitals.oneOnOneCoverage.status === "bad") &&
              vitals.oneOnOneCoverage.uncoveredMembers.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {vitals.oneOnOneCoverage.uncoveredMembers.slice(0, 3).map((name) => (
                    <button key={name} className={styles.btnOutline} onClick={() => prefillJournal(`#1on1 @${name} `)}>
                      {name}の1on1を記録
                    </button>
                  ))}
                </div>
              )}
          </div>
          )}

          {vitalsLoaded && vitals.teams.length === 0 && (
            <p className={styles.subtitle}>
              自分が管理するチームがありません。
              <button className={styles.detailToggle} onClick={() => router.push("/teams")}>
                チームで設定
              </button>
            </p>
          )}
        </div>
      </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.detailHeader} style={{ alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>
            メモする{" "}
            <span
              className={styles.subtitle}
              style={{ fontWeight: 400, cursor: "help" }}
              title="入力後、完全ローカルの軽量モデル（LFM2.5-350M、外部送信なし）がタグ・人物・緊急度・感情を自動抽出します。"
            >
              ⓘ
            </span>
          </h2>
          <button className={styles.btnOutline} onClick={() => router.push("/journal")}>
            すべて見る →
          </button>
        </div>
        <form onSubmit={handleJournalSubmit}>
          <div className={styles.journalInputRow}>
            <textarea
              id="quick-journal-input"
              value={journalText}
              onChange={(e) => setJournalText(e.target.value)}
              rows={3}
              placeholder="例: 今日のAさんとの1on1で、リファクタリングが進まないことへの不満を聞いた…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                }
              }}
            />
            <button className={styles.primaryBtn} style={{ width: "auto" }} type="submit" disabled={!journalText.trim()}>
              Submit
            </button>
          </div>
          {/* 改修依頼「通常投入でも日付レベルの訂正を検討」対応。既定は今日のまま・
              非表示。今日の話でないと分かっているときだけ開いて日付を選べる。 */}
          {journalDateOpen ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                発生日
                <input type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} style={{ maxWidth: 160 }} />
              </label>
              <button
                type="button"
                className={`${styles.detailToggle} ${styles.detailToggleButton}`}
                onClick={() => {
                  setJournalDate("");
                  setJournalDateOpen(false);
                }}
              >
                今日に戻す
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`${styles.detailToggle} ${styles.detailToggleButton}`}
              style={{ marginTop: 6 }}
              onClick={() => setJournalDateOpen(true)}
            >
              📅 今日の話じゃない（発生日を変える）
            </button>
          )}
        </form>
        {journalError && <p className={styles.errorText} role="alert">{journalError}</p>}

        <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <button className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={() => setBulkOpen(!bulkOpen)}>
            📥 まとめて記録する（後からまとめて書きたいとき） {bulkOpen ? "▲" : "▼"}
          </button>
          {bulkOpen && (
            <form onSubmit={handleBulkSubmit} style={{ marginTop: 8 }}>
              <p className={styles.subtitle} style={{ marginBottom: 6 }}>
                1行＝1つの出来事です。日付が変わるときだけ、その行だけに日付を書いてください（例:
                3/5・月曜・昨日）。省略した行は直前の日付のままになります。時刻は不要です。
              </p>
              <textarea
                rows={5}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                style={{
                  width: "100%",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "8px 10px",
                  fontSize: "0.8125rem",
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
                placeholder={"3/5\nAさんと1on1。異動の相談を受けた\nBチームとの調整が難航\n月曜\nCさんが有休、引き継ぎ確認"}
              />
              <button
                className={styles.primaryBtn}
                style={{ width: "auto", marginTop: 8 }}
                type="submit"
                disabled={!bulkText.trim()}
              >
                まとめて記録する
              </button>
              {bulkError && <p className={styles.errorText} role="alert">{bulkError}</p>}
              {bulkResultMessage && (
                <p className={styles.subtitle} style={{ marginTop: 6 }} role="status">
                  ✅ {bulkResultMessage}
                </p>
              )}
            </form>
          )}
        </div>

        {journalEntries.length > 0 && (
          <label
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 10 }}
          >
            <input
              type="checkbox"
              checked={excludeResolvedJournal}
              onChange={(e) => setExcludeResolvedJournal(e.target.checked)}
            />
            ✅ 対応済み/Issue化済みを除外
          </label>
        )}
        {journalEntries.length === 0 && pendingJournalDrafts.length === 0 && (
          <p className={styles.subtitle}>{journalLoaded ? "まだジャーナルはありません。" : "読み込み中…"}</p>
        )}
        {journalLoaded && journalEntries.length > 0 && visibleJournalEntries.length === 0 && pendingJournalDrafts.length === 0 && (
          <p className={styles.subtitle}>条件に一致するJournalはありません。</p>
        )}
        {pendingJournalDrafts.map((draft) => (
          <div key={draft.tempId} className={styles.journalEntry}>
            <div>{draft.label}</div>
            {draft.error ? (
              <div className={styles.tagRow} style={{ marginTop: 4 }}>
                <span className={styles.errorText} role="alert">
                  ⚠️ {draft.error}
                </span>
                <button className={styles.btnOutline} onClick={draft.retry}>
                  再試行
                </button>
                <button
                  className={styles.btnOutline}
                  onClick={() => setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== draft.tempId))}
                >
                  取り消す
                </button>
              </div>
            ) : (
              <p className={styles.subtitle} style={{ marginTop: 4 }} role="status">
                <span className={styles.spinner} aria-hidden="true" />
                ローカルAIでタグ付け中…
              </p>
            )}
          </div>
        ))}
        {recentJournalEntries.map((entry) => (
          <JournalEntryCard
            key={entry.id}
            entry={entry}
            editing={journalEditing.editingEntryId === entry.id}
            editRawText={journalEditing.editRawText}
            editTags={journalEditing.editTags}
            editPeople={journalEditing.editPeople}
            editTeams={journalEditing.editTeams}
            editUrgency={journalEditing.editUrgency}
            editDate={journalEditing.editDate}
            editSubmitting={journalEditing.editSubmitting}
            editError={journalEditing.editError}
            resolutionNoteDraft={journalEditing.resolutionNoteDraft}
            pending={journalEditing.isEntryPending(entry.id)}
            pendingError={journalEditing.pendingEntryErrors[entry.id]}
            onDismissPendingError={() => journalEditing.dismissPendingError(entry.id)}
            onChangeEditRawText={journalEditing.setEditRawText}
            onChangeEditTags={journalEditing.setEditTags}
            onChangeEditPeople={journalEditing.setEditPeople}
            onChangeEditTeams={journalEditing.setEditTeams}
            onChangeEditUrgency={journalEditing.setEditUrgency}
            onChangeEditDate={journalEditing.setEditDate}
            onChangeResolutionNoteDraft={journalEditing.setResolutionNoteDraft}
            onConfirmEdit={() => journalEditing.confirmEdit(entry.id)}
            onConfirmAsIs={() => journalEditing.confirmAsIs(entry)}
            onStartAnalysis={() => journalEditing.startAnalysis(entry)}
            onCancelEdit={journalEditing.cancelEditing}
            onStartEdit={() => journalEditing.startEditing(entry)}
            onResolveWithNote={() => journalEditing.resolveWithNote(entry.id)}
            onResolveWithNewIssue={() => journalEditing.resolveWithNewIssue(entry)}
            onClearResolution={() => journalEditing.clearResolution(entry.id)}
          />
        ))}
        {visibleJournalEntries.length > JOURNAL_DASHBOARD_LIMIT && (
          <p className={styles.subtitle} style={{ marginTop: -4, marginBottom: 12 }}>
            他{visibleJournalEntries.length - JOURNAL_DASHBOARD_LIMIT}件は
            <button className={styles.detailToggle} onClick={() => router.push("/journal")}>
              Journal一覧
            </button>
            から確認できます。
          </p>
        )}

        <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <button className={`${styles.detailToggle} ${styles.detailToggleButton}`} onClick={() => setProfileOpen(!profileOpen)}>
            長期プロファイルを記録する {profileOpen ? "▲" : "▼"}
          </button>
          {profileOpen && (
            <>
              <p className={styles.subtitle} style={{ margin: "6px 0 8px" }}>
                「Aさんはリーダー志向がある」のような長期的な解釈を、Quick Journalとは別に期限切れなく記録します。
              </p>
              <form onSubmit={handleProfileSubmit}>
                <div className={styles.journalInputRow}>
                  <input
                    type="text"
                    value={profilePerson}
                    onChange={(e) => setProfilePerson(e.target.value)}
                    placeholder="対象（例: Aさん）"
                    style={{ maxWidth: 140 }}
                  />
                  <textarea
                    value={profileText}
                    onChange={(e) => setProfileText(e.target.value)}
                    rows={2}
                    placeholder="例: Aさんはリーダー志向がある"
                  />
                  <button
                    className={styles.primaryBtn}
                    style={{ width: "auto" }}
                    type="submit"
                    disabled={profileSubmitting || !profilePerson.trim() || !profileText.trim()}
                  >
                    {profileSubmitting ? "記録中…" : "記録"}
                  </button>
                </div>
              </form>
              {profileError && <p className={styles.errorText} role="alert">{profileError}</p>}
              {profileSaved && (
                <p className={styles.subtitle} role="status">
                  ✅ 長期プロファイルとして記録しました。
                </p>
              )}

              <button
                type="button"
                className={styles.btnOutline}
                style={{ marginTop: 8 }}
                onClick={handleDraftProfile}
                disabled={draftStarting || !profilePerson.trim() || draftRunBusy}
              >
                {draftStarting || draftRunBusy ? "AIが下書きを作成中…" : "🤖 AIに下書きを提案してもらう"}
              </button>
              <p
                className={styles.subtitle}
                style={{ marginTop: 4 }}
                title="対象欄の人物名をもとにPeople Agentが下書きを作成します。保存するかはEMが判断してください。"
              >
                ⓘ あくまで下書きです。「記録」を押すまで保存されません。
              </p>
              {draftError && <p className={styles.errorText} role="alert">{draftError}</p>}
            </>
          )}
        </div>
      </div>
      {nameCandidateDialog}
      {journalEditing.nameCandidateDialog}
      {confirmingUnmasked && (
        <NameCandidateConfirmDialog
          candidates={confirmingUnmasked.candidates}
          actionLabel="送信する"
          busy={confirmingUnmaskedBusy}
          onCancel={async () => {
            setConfirmingUnmaskedBusy(true);
            try {
              await fetch(`/api/agents/pending-unmasked/${encodeURIComponent(confirmingUnmasked.id)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "dismiss" }),
              });
              await refreshRuns();
            } finally {
              setConfirmingUnmaskedBusy(false);
              setConfirmingUnmasked(null);
            }
          }}
          onAllow={async () => {
            setConfirmingUnmaskedBusy(true);
            try {
              await fetch(`/api/agents/pending-unmasked/${encodeURIComponent(confirmingUnmasked.id)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "confirm" }),
              });
              await refreshRuns();
            } finally {
              setConfirmingUnmaskedBusy(false);
              setConfirmingUnmasked(null);
            }
          }}
          onRegister={async () => {
            setConfirmingUnmaskedBusy(true);
            try {
              await fetch(`/api/agents/pending-unmasked/${encodeURIComponent(confirmingUnmasked.id)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "confirm", registerNameCandidates: true }),
              });
              await refreshRuns();
            } finally {
              setConfirmingUnmaskedBusy(false);
              setConfirmingUnmasked(null);
            }
          }}
        />
      )}
    </div>
  );
}

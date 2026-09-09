"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { runKindLabel } from "@/components/RunDetail";
import { JournalEntryCard } from "@/components/JournalEntryCard";
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
  useVitals,
} from "@/lib/hooks";
import {
  charterFilledCount,
  isJournalEntryResolved,
  isRunStale,
  type Issue,
  type JournalEntry,
} from "@/lib/types";

const JOURNAL_DASHBOARD_LIMIT = 5;
const NEXT_ACTIONS_LIMIT = 6;
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
};

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
    text: "朝のチェック: 下の判断待ちから片づけましょう。",
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

  const { runs, refreshRuns } = useRuns();
  const { issues } = useIssues();
  const goToRunIssue = useGoToRunIssue(issues);
  const { vitals } = useVitals();
  const { journalEntries, setJournalEntries } = useJournal();
  // 改修依頼「今日の振り返りに、今日記録されていない場合のアラートを出す」対応。
  const { checkins } = useEmCheckins();
  const { rules } = useSettingsRules();
  // docs/memo.md「O. 期初の憲法づくりオンボーディング」対応。
  const { strategy } = useOrgStrategy();
  const { teams } = useTeams();
  const { objectives } = useObjectives();
  // docs/em_human_story_and_ux.md P1-10対応。People(J)を朝キューにも薄く編入する。
  const { people } = usePeople();

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
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  // docs/dashboard_ui_readability.md U4-1対応。Quick Journalと長期プロファイルが
  // 同一パネル内で「入力が2種類」に見えないよう、長期プロファイルは既定で畳んでおく。
  const [profileOpen, setProfileOpen] = useState(false);

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
        const res = await fetch("/api/journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, occurredAtDate }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "タグ付けに失敗しました");
        setJournalEntries((prev) => [data.entry, ...prev]);
        setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
      } catch (err) {
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
        const res = await fetch("/api/journal/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "まとめ記録に失敗しました");
        const newEntries = data.entries as JournalEntry[];
        setJournalEntries((prev) => [...newEntries, ...prev]);
        setPendingJournalDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
        setBulkResultMessage(
          `${newEntries.length}件を記録しました（いずれも未確認）。内容と発生日を確認してください。${
            data.skippedLines > 0 ? ` ※${data.skippedLines}行は上限を超えたため処理していません。` : ""
          }`,
        );
      } catch (err) {
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
    // ユーザー指摘「却下したのに『今日』の判断待ちに残り続ける」対応。agent-runtime.tsの
    // setRunTriageStatusは「様子見/却下どちらもreviewed=trueになり次にすべきことの
    // 緊急度から外れる」設計だが、下のstale/yield/error分岐にはreviewed/triageStatusの
    // チェックが無く、statusがyield/error/無応答のままだと却下後も表示され続けてしまって
    // いた（idle分岐のisUnreviewedAutoだけが正しくガードされていた）。EMが明示的に
    // 様子見／却下を選んだrunは、statusに関わらずここでは扱わない
    // （様子見は下のwatchingItemsで別途表示、却下は対応不要として消える）。
    if (run.triageStatus === "watching" || run.triageStatus === "dismissed") continue;

    // AI主導（イベント駆動・バッチ駆動、docs/first_implession 3.6/3.7）で自動起動されたrunは、
    // EMがまだ内容を確認していない（reviewed=false）間はstatusに関わらず必ずここに残す
    // （idleで完結していても「対応不要」と見なさない——見て見ぬふりを防ぐ）。クリック先も
    // 通常のgoToRunIssue（即Issue化）ではなく、EMが中身を見てからIssue化/却下を選べる
    // /chatへ寄せる。
    const isUnreviewedAuto = run.origin !== "manual" && !run.reviewed;
    const autoLabel = run.origin === "auto-anomaly" ? "AIが異常を検知" : "朝のサマリー";
    const onSelectAuto = () => router.push(`/chat?runId=${run.id}`);
    // docs/em_human_story_and_ux.md P0-2対応（修正）。自動検知drafts（isUnreviewedAuto）だけ
    // でなく、まだIssueに紐付いていないLead Agent run全般（手動で始めた「何でも相談」が
    // Yield/エラー/無応答になっている場合を含む）も、クリックしたらgoToRunIssueで即Issue化
    // せず/chatへ寄せる。Lead Agentは「相談」の相手であり、決まった介入ではないため。
    const isLeadUnlinked = run.agentName === "Lead Agent" && !issues.some((i) => i.agentRunId === run.id);

    if (staleRunIds.has(run.id)) {
      const minutes = Math.round((now - run.updatedAt) / 60000);
      nextActions.push({
        id: `stale-${run.id}`,
        severity: "urgent",
        lane: "decision",
        icon: "❔",
        kindLabel: isUnreviewedAuto ? runKindLabel(run) : "実行異常",
        text: `${run.agentName}が${minutes}分応答していません（動いているように見えて止まっている可能性）: ${run.task.slice(0, 30)}`,
        onSelect: isLeadUnlinked ? onSelectAuto : () => goToRunIssue(run),
        since: run.updatedAt,
      });
    } else if (run.status === "yield") {
      nextActions.push({
        id: `yield-${run.id}`,
        severity: "urgent",
        lane: "decision",
        icon: "🟡",
        kindLabel: isUnreviewedAuto ? runKindLabel(run) : "Yield",
        text: `${isUnreviewedAuto ? `${autoLabel}: ` : `${run.agentName}が判断待ちです: `}${(run.yieldRequest?.reason ?? run.task).slice(0, 44)}`,
        onSelect: isLeadUnlinked ? onSelectAuto : () => goToRunIssue(run),
        since: run.updatedAt,
      });
    } else if (run.status === "error") {
      nextActions.push({
        id: `error-${run.id}`,
        severity: "urgent",
        lane: "decision",
        icon: "🔴",
        kindLabel: isUnreviewedAuto ? runKindLabel(run) : "実行異常",
        text: `${isUnreviewedAuto ? `${autoLabel}（エラー）: ` : `${run.agentName}でエラーが発生しました: `}${run.task.slice(0, 44)}`,
        onSelect: isLeadUnlinked ? onSelectAuto : () => goToRunIssue(run),
        since: run.updatedAt,
      });
    } else if (isUnreviewedAuto && run.status === "idle") {
      // docs/memo.md「A」対応。異常検知ドラフトはtaskの要約より、Lead Agentが出した
      // 結論（proposal.conclusion）の方がEMの判断材料として有用なので優先して見せる。
      nextActions.push({
        id: `auto-${run.id}`,
        severity: "warn",
        lane: "decision",
        icon: "🤖",
        kindLabel: runKindLabel(run),
        text: run.proposal?.conclusion ? run.proposal.conclusion.slice(0, 60) : `${autoLabel}: ${run.task.slice(0, 44)}`,
        onSelect: onSelectAuto,
        since: run.updatedAt,
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
        onSelect: () => router.push(`/chat?prefill=${encodeURIComponent(`${entry.rawText}について、対応方針を相談したい`)}`),
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
        text: `内容を確認して確定してください（緊急度high・未確認）: ${(entry.summary || entry.rawText).slice(0, 36)}`,
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
  const watchingItems = runs.filter((r) => r.triageStatus === "watching");
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
      kindLabel: "自動起動まとめ",
      text: `AIの自動起動ドラフトが${autoDraftIds.size}件たまっています。相談履歴からまとめて確認してください`,
      onSelect: () => router.push("/chat"),
      since: 0,
    });
  }

  nextActions.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "urgent" ? -1 : 1));

  const laneCounts: Record<Lane, number> = { decision: 0, observation: 0, maintenance: 0 };
  for (const a of nextActions) laneCounts[a.lane]++;

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
  // 自然に消える）。
  const setupGaps: string[] = [];
  if (!strategy.mission && !strategy.vision && !strategy.values) setupGaps.push("MVV未設定");
  if (teams.length === 0) setupGaps.push(`Team ${teams.length}件`);
  if (objectives.length === 0) setupGaps.push(`Objective ${objectives.length}件`);

  // docs/em_human_story_and_ux.md P0-5対応。先頭を「今日の組織の問い」1文へ圧縮する。
  // docs/em_ui_ux_issue.md 2.2/4節「AI主導トリアージ・上限N件への圧縮」対応。レーンごとに
  // 上限を分ける（判断待ちは特に少数に絞る）。超過分は非表示にせず、下の案内から
  // Issue一覧・Organization Contextで確認できる（情報を失わない）。
  const LANE_LIMITS: Record<Lane, number> = {
    decision: rules.decisionQueueLimit,
    observation: rules.observationQueueLimit,
    maintenance: NEXT_ACTIONS_LIMIT,
  };
  const laneActionsForFilter = nextActions.filter((a) => a.lane === laneFilter);
  const laneLimit = LANE_LIMITS[laneFilter];
  const visibleActions = laneActionsForFilter.slice(0, laneLimit);
  // 絞り込みは下のタブだけで行う（見出し内の件数はクリックできない、ただの要約）。
  const headline =
    nextActions.length === 0
      ? "✅ 今日、判断待ちの組織課題はありません。"
      : `🧭 今日: 判断待ち${laneCounts.decision}件・観測不足${laneCounts.observation}件・整備${laneCounts.maintenance}件`;

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
          <button className={styles.btnOutline} style={{ flexShrink: 0 }} onClick={() => router.push("/org")}>
            Organization Contextへ
          </button>
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
          {!hasCheckinToday && (
            <div className={styles.charterWarnBanner}>
              ⚠️ まだ今日のチェックイン（気分・エネルギー・ストレス）を記録していません。
            </div>
          )}
          <button className={styles.btnOutline} onClick={() => router.push("/growth")}>
            EMの成長へ →
          </button>
        </div>
      )}

      {/* docs/em_human_story_and_ux.md P0-5 / docs/dashboard_ui_readability.md U0-1対応。
          先頭ブロックを視覚的な「主」にする。1文の見出し＋レーン別タブで、朝の視線を
          最初にトリアージへ着地させる。
          ユーザー指摘「幅に余裕があるときは判断待ちとチームの状態を横並びにし、PC画面では
          ファーストビューに収める」対応。dashColumns（既存の2カラムgrid、1000px未満で
          縦積み）を再利用し、どちらも自身の高さのまま隣接させる（align-items: start）。 */}
      <div className={styles.dashColumns}>
      <div className={`${styles.panel} ${styles.heroPanel}`}>
        <h2 className={styles.heroHeadline}>{headline}</h2>

        <div className={styles.tabs} style={{ margin: "10px 0" }}>
          {(Object.keys(LANE_META) as Lane[]).map((lane) => (
            <button
              key={lane}
              className={`${styles.tabBtn} ${laneFilter === lane ? styles.tabBtnActive : ""}`}
              onClick={() => setLaneFilter(lane)}
              title={LANE_META[lane].hint}
            >
              {LANE_META[lane].label}（{laneCounts[lane]}）
            </button>
          ))}
        </div>

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
            🤖 本日のAI自動起動: {autoRunsToday}件
            <button className={styles.detailToggle} style={{ marginLeft: 6 }} onClick={() => router.push("/settings")}>
              頻度を調整
            </button>
          </p>
        )}

        {visibleActions.length === 0 ? (
          <p className={styles.subtitle}>✅ このレーンに対応が必要な項目はありません。</p>
        ) : (
          <>
            {/* 改修依頼「表形式を戻してほしい」対応。ここは判断1件ずつを個別に読んで
                クリックする場面で、カラム分けよりも「1件＝1カード」の一覧性が重要
                なため、表形式ではなくボタン（カード）の並びに戻す。 */}
            <div className={styles.runList} style={{ maxHeight: "none" }}>
              {visibleActions.map((a) => (
                <button
                  key={a.id}
                  className={`${styles.runItem} ${a.severity === "urgent" ? styles.nextActionUrgent : styles.nextActionWarn}`}
                  onClick={a.onSelect}
                >
                  <span className={styles.badge}>{a.kindLabel}</span>
                  {/* 改修依頼「以前から変わったことがより分かりやすいUIに」対応。前回訪問より
                      後に発生・更新された根拠を持つカードだけに新着マークを出す。 */}
                  {lastSeenAt !== null && a.since > lastSeenAt && <span className={styles.newBadge}>新着</span>}
                  <div className={styles.runItemTask}>{a.text}</div>
                </button>
              ))}
            </div>
            {laneActionsForFilter.length > laneLimit && (
              <p className={styles.subtitle} style={{ marginTop: 8 }}>
                このレーンに他{laneActionsForFilter.length - laneLimit}件（Issue一覧・Organization Contextから確認できます）
              </p>
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
                      return (
                        <tr key={run.id}>
                          <td className={styles.tableMuted}>{days === 0 ? "今日から" : `${days}日前から`}</td>
                          <td>
                            <button className={styles.tableRowLink} onClick={() => router.push(`/chat?runId=${run.id}`)}>
                              {run.task.slice(0, 50)}
                            </button>
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
            <p className={styles.subtitle}>情報が足りない場合は「評価不能」と表示します。</p>
          </div>
          <div className={styles.vitalsLegend}>
            <span>🟢 安定</span>
            <span>🟡/🔴 要注意・危険</span>
            <span>⚪️ 評価不能（情報不足）</span>
          </div>
        </div>

        <div className={styles.vitalsGrid}>
          {vitals.teams.map((v) => (
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

          {vitals.teams.length === 0 && (
            <p className={styles.subtitle}>
              チームが登録されていません。
              <button className={styles.detailToggle} onClick={() => router.push("/org")}>
                Organization Contextから追加
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
              title="入力後、完全ローカルの軽量モデル（Qwen2.5-0.5B、外部送信なし）がタグ・人物・緊急度・感情を自動抽出します。"
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
            <input
              id="quick-journal-input"
              type="text"
              value={journalText}
              onChange={(e) => setJournalText(e.target.value)}
              placeholder="例: 今日のAさんとの1on1で、リファクタリングが進まないことへの不満を聞いた…"
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
            ✅ 対応済みを除外
          </label>
        )}
        {journalEntries.length === 0 && pendingJournalDrafts.length === 0 && (
          <p className={styles.subtitle}>まだジャーナルはありません。</p>
        )}
        {journalEntries.length > 0 && visibleJournalEntries.length === 0 && pendingJournalDrafts.length === 0 && (
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
            onChangeEditUrgency={journalEditing.setEditUrgency}
            onChangeEditDate={journalEditing.setEditDate}
            onChangeResolutionNoteDraft={journalEditing.setResolutionNoteDraft}
            onConfirmEdit={() => journalEditing.confirmEdit(entry.id)}
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
                  <input
                    type="text"
                    value={profileText}
                    onChange={(e) => setProfileText(e.target.value)}
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
    </div>
  );
}

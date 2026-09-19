// docs/2nd_pivot_version.md Phase 1対応。「Issueが何件あるか」ではなく、
// docs/2nd_pivot_version/pivot_policy.md「目指すUX」の6項目
// （昨日から変わったこと／気になる兆候／良い状態／評価できないこと／過去との比較／
// 判断する価値がありそうなこと）でEMに状況を提示するための純粋関数群。
// この段階ではIssueの内部データモデルには触れず、既にクライアント側で取得済みの
// Journal / Vitals / People / NextActionsだけを組み替えて使う
// （新しいAPI・永続化エンティティは追加しない）。
import { periodWindow } from "@core/daily-trends";
import type { NextAction } from "@/lib/dashboard-next-actions";
import { PERSON_VITAL_LABEL, personVitalStatus, isJournalEntryResolved } from "@core/types";
import type { JournalEntry, OrgVitals, PersonSummary, VitalStatus } from "@core/types";

export type SituationItem = {
  id: string;
  text: string;
  since: number;
  onSelect?: () => void;
  /** 気になる兆候／良い状態／評価できないことの表示色分けに使う。ステータス系以外の
   * カテゴリ（changes/comparisons/worthDeciding）では付けない。 */
  status?: VitalStatus;
  /** 状態チップのホバー詳細（根拠・件数等）。ユーザー指摘「色でわかるので名前だけで
   * 良い」対応でtextはチーム名／メンバー名だけにし、根拠はこちらへ逃がす。 */
  detail?: string;
  /** 状態チップの段落分け（チーム／メンバー）に使う。ユーザー指摘「チーム・メンバーが
   * 混合で並んでいる」対応。ステータス系以外のカテゴリでは付けない。 */
  entityKind?: "team" | "person";
};

export type DailySituation = {
  changes: SituationItem[];
  concerns: SituationItem[];
  good: SituationItem[];
  unevaluable: SituationItem[];
  comparisons: SituationItem[];
  worthDeciding: SituationItem[];
  /** worthDecidingで切り捨てた残数（「今日やるべきこと」へ誘導するために使う）。 */
  worthDecidingOverflow: number;
};

const CHANGES_WINDOW_MS = 24 * 60 * 60 * 1000;
const CONCERN_JOURNAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CATEGORY_LIMIT = 6;
const WORTH_DECIDING_LIMIT = 5;

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export type BuildDailySituationParams = {
  now: number;
  journalEntries: JournalEntry[];
  vitals: OrgVitals;
  people: PersonSummary[];
  nextActions: NextAction[];
  push: (path: string) => void;
  /** ユーザー指摘「1on1 Coverageチップが誰の1on1不足か分からないままチーム画面へ
   * 飛ばすだけ」対応。未実施メンバーが分かっている場合は、遷移ではなく
   * Quick Journalへのプリフィルで直接記録へ誘導する。 */
  prefillJournal: (text: string) => void;
};

export function buildDailySituation(params: BuildDailySituationParams): DailySituation {
  const { now, journalEntries, vitals, people: allPeople, nextActions, push, prefillJournal } = params;
  // docs/memo.md「今日の状況に表示するメンバーを自分の管理するチームのメンバーだけに
  // する」対応。ステータスチップ・比較欄で扱う「メンバー」は、自分が管理するチーム
  // （Team.managedByEm、兼務含む）に所属する人物（PersonSummary.isDirectReport）に限る。
  const people = allPeople.filter((p) => p.isDirectReport);

  // 1. 昨日から変わったこと: 直近24時間に記録されたJournal。
  const changes: SituationItem[] = journalEntries
    .filter((e) => now - e.createdAt <= CHANGES_WINDOW_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, CATEGORY_LIMIT)
    .map((e) => ({
      id: `changes-journal-${e.id}`,
      text: truncate(e.summary || e.rawText, 60),
      since: e.createdAt,
      onSelect: () => push(`/journal?focus=${e.id}`),
    }));

  // 2. 気になる兆候: Team/PersonのVitalsがbad/warn（status付き＝状態チップ表示）、
  // または直近の緊急ネガティブJournal（statusを付けない＝個別の出来事として文章表示）。
  // チーム個別ページが無いため、/teams?focus=<teamId>で同一チームを開く
  // （/journal?focus=と同じ導線。テキストの対象とリンク先を一致させる）。
  const concerns: SituationItem[] = [];
  for (const t of vitals.teams) {
    if (t.status === "bad" || t.status === "warn") {
      concerns.push({
        id: `concern-team-${t.teamId}`,
        text: t.teamName,
        detail: `${t.teamName}: ${t.label}（${truncate(t.reason, 40)}）`,
        since: 0,
        onSelect: () => push(`/teams?focus=${t.teamId}`),
        status: t.status,
        entityKind: "team",
      });
    }
  }
  for (const p of people) {
    const status = personVitalStatus(p.trend, p.hasConcerningIssue);
    if (status === "bad" || status === "warn") {
      concerns.push({
        id: `concern-person-${p.id}`,
        text: p.name,
        detail: `${p.name}: ${PERSON_VITAL_LABEL[status]}（🙂${p.trend.positive} 🙁${p.trend.negative}）`,
        since: 0,
        onSelect: () => push(`/people/${p.id}`),
        status,
        entityKind: "person",
      });
    }
  }
  for (const e of journalEntries) {
    if (now - e.createdAt > CONCERN_JOURNAL_WINDOW_MS) continue;
    if (isJournalEntryResolved(e)) continue;
    // ユーザー指摘「確認済み（対応不要）にしたJournalはメンバーのアラート換算から外したい」対応。
    if (e.noActionNeededAt) continue;
    // docs/memo.md「紐づく提案がすでにあるJournalは確認案内をなくす/弱める」対応。
    // すでにLead Agent runが生まれている（＝提案が生成済み・進行中）Journalは、
    // 気になることとして重ねて出さない（提案側の確認導線で追える）。
    if (e.sourceConsultRunId) continue;
    if (e.urgency === "high" && e.sentiment === "negative") {
      concerns.push({
        id: `concern-journal-${e.id}`,
        text: truncate(e.summary || e.rawText, 60),
        since: e.createdAt,
        onSelect: () => push(`/journal?focus=${e.id}`),
        // statusを付けない: Team/PersonのVitalsのような継続的な状態ではなく、
        // 個別の出来事なので状態チップ（.situationChipRow）へ混ぜない。
      });
    }
  }
  concerns.sort((a, b) => b.since - a.since);

  // 3. 良い状態: Team/PersonのVitalsがgood。
  const good: SituationItem[] = [];
  // ユーザー指摘「チームの状態パネルと今日の状況のチーム表示が被っている」対応。
  // 独立パネル（旧TeamStatePanel）を廃止し、1on1 Coverageもチーム・メンバーの状態
  // チップへ統合する。bad/warn（観測不足）は「評価できないこと」へ、good（良好）は
  // こちらへ振り分ける。各カテゴリはCATEGORY_LIMIT件に切り詰められるため、
  // メンバー数が多いと後段のteam/personループに押し出されて消えないよう先頭に置く。
  if (vitals.oneOnOneCoverage.status === "good") {
    good.push({
      id: "good-coverage",
      text: "1on1 Coverage",
      detail: `1on1 Coverageは${vitals.oneOnOneCoverage.covered}/${vitals.oneOnOneCoverage.total}件です`,
      since: 0,
      onSelect: () => push("/teams"),
      status: "good",
      entityKind: "team",
    });
  }
  for (const t of vitals.teams) {
    if (t.status === "good") {
      good.push({
        id: `good-team-${t.teamId}`,
        text: t.teamName,
        detail: `${t.teamName}: ${t.label}`,
        since: 0,
        onSelect: () => push(`/teams?focus=${t.teamId}`),
        status: "good",
        entityKind: "team",
      });
    }
  }
  for (const p of people) {
    if (personVitalStatus(p.trend, p.hasConcerningIssue) === "good") {
      good.push({
        id: `good-person-${p.id}`,
        text: p.name,
        detail: `${p.name}: ${PERSON_VITAL_LABEL.good}（🙂${p.trend.positive} 🙁${p.trend.negative}）`,
        since: 0,
        onSelect: () => push(`/people/${p.id}`),
        status: "good",
        entityKind: "person",
      });
    }
  }

  // 4. 評価できないこと: Team/PersonのVitalsがunknown、1on1 Coverage不足。
  const unevaluable: SituationItem[] = [];
  // good側と同様、メンバー数が多いとteam/personループに押し出されて消えないよう先頭に置く。
  if (vitals.oneOnOneCoverage.status === "bad" || vitals.oneOnOneCoverage.status === "warn") {
    const uncovered = vitals.oneOnOneCoverage.uncoveredMembers;
    // ユーザー指摘「誰の1on1が不足しているか分からないまま、押すとチーム画面へ飛ばされる
    // だけ」対応。未実施メンバー名をdetail（ホバー）に出し、クリックは/teamsへの遷移では
    // なく、先頭の未実施メンバーの1on1をQuick Journalへプリフィルする行動に変える
    // （dashboard-next-actions.tsの「1on1不足」カードと同じ導線に揃える）。
    const uncoveredNote =
      uncovered.length > 0 ? `（未実施: ${uncovered.slice(0, 3).join("、")}${uncovered.length > 3 ? ` ほか${uncovered.length - 3}名` : ""}）` : "";
    unevaluable.push({
      id: "unevaluable-coverage",
      text: "1on1 Coverage",
      detail: `1on1 Coverageが${vitals.oneOnOneCoverage.covered}/${vitals.oneOnOneCoverage.total}件と少なく、観測が不足しています${uncoveredNote}`,
      since: 0,
      onSelect: () => prefillJournal(uncovered[0] ? `#1on1 @${uncovered[0]} ` : ""),
      status: vitals.oneOnOneCoverage.status,
      entityKind: "team",
    });
  }
  for (const t of vitals.teams) {
    if (t.status === "unknown") {
      unevaluable.push({
        id: `unevaluable-team-${t.teamId}`,
        text: t.teamName,
        detail: `${t.teamName}: ${t.label}`,
        since: 0,
        onSelect: () => push(`/teams?focus=${t.teamId}`),
        status: "unknown",
        entityKind: "team",
      });
    }
  }
  for (const p of people) {
    if (personVitalStatus(p.trend, p.hasConcerningIssue) === "unknown") {
      unevaluable.push({
        id: `unevaluable-person-${p.id}`,
        text: p.name,
        detail: `${p.name}: ${PERSON_VITAL_LABEL.unknown}`,
        since: 0,
        onSelect: () => push(`/people/${p.id}`),
        status: "unknown",
        entityKind: "person",
      });
    }
  }

  // 5. 過去との比較: 今週と先週のJournal件数比較（量的比較）。
  // ユーザー指摘「過去との比較に長期プロファイルが混ざってくる」対応。長期プロファイル
  // （KnowledgeEvent kind:interpretation）はTTLの無い恒常的な人物解釈であり、「今週→先週で
  // 何が変わったか」という過去比較の趣旨とは性質が異なる（変化ではなく前提事実）ため、
  // ここでは混ぜない。長期プロファイルは人物詳細画面で確認する。
  const comparisons: SituationItem[] = [];
  const thisWeek = periodWindow("week", 0, now);
  const lastWeek = periodWindow("week", -1, now);
  const countBySentiment = (window: { start: number; end: number }, sentiment: JournalEntry["sentiment"]) =>
    journalEntries.filter((e) => e.createdAt >= window.start && e.createdAt < window.end && e.sentiment === sentiment).length;
  const thisNegative = countBySentiment(thisWeek, "negative");
  const lastNegative = countBySentiment(lastWeek, "negative");
  const thisPositive = countBySentiment(thisWeek, "positive");
  const lastPositive = countBySentiment(lastWeek, "positive");
  if (thisNegative + lastNegative + thisPositive + lastPositive > 0) {
    comparisons.push({
      id: "comparison-journal-trend",
      text: `今週のJournalは 🙂${thisPositive}（先週🙂${lastPositive}） 🙁${thisNegative}（先週🙁${lastNegative}）`,
      since: 0,
    });
  }

  // 6. 判断する価値がありそうなこと: 既存のNext Actionsのうち「判断待ち」レーン。
  const decisionActions = nextActions.filter((a) => a.lane === "decision");
  const worthDeciding: SituationItem[] = decisionActions.slice(0, WORTH_DECIDING_LIMIT).map((a) => ({
    id: `worth-${a.id}`,
    text: a.text,
    since: a.since,
    onSelect: a.onSelect,
  }));

  return {
    changes,
    concerns: concerns.slice(0, CATEGORY_LIMIT),
    good: good.slice(0, CATEGORY_LIMIT),
    unevaluable: unevaluable.slice(0, CATEGORY_LIMIT),
    comparisons,
    worthDeciding,
    worthDecidingOverflow: Math.max(0, decisionActions.length - WORTH_DECIDING_LIMIT),
  };
}

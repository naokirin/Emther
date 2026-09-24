// docs/2nd_pivot_version.md Phase 1対応。「提案が何件あるか」ではなく、
// docs/2nd_pivot_version/pivot_policy.md「目指すUX」の6項目
// （昨日から変わったこと／気になる兆候／良い状態／評価できないこと／過去との比較／
// 判断する価値がありそうなこと）でEMに状況を提示するための純粋関数群。
// この段階では提案の内部データモデルには触れず、既にクライアント側で取得済みの
// Journal / Vitals / People / NextActions / Suggestionsだけを組み替えて使う
// （新しいAPI・永続化エンティティは追加しない）。
import { periodWindow } from "./daily-trends";
import type { NextAction, NextActionTarget } from "./dashboard-next-actions";
import {
  PERSON_VITAL_LABEL,
  personVitalStatus,
  isSuggestionStalled,
} from "./types";
import type { JournalEntry, OrgVitals, PersonSummary, Suggestion, VitalStatus } from "./types";

/** 気になる兆候のシグナル種別（組織レベルの材料。個体ナビは「注目」チップ側）。 */
export type ConcernSignalKind = "vitals" | "tone" | "spread" | "journal-volume" | "stalled-suggestions";

export const CONCERN_SIGNAL_LABEL: Record<ConcernSignalKind, string> = {
  vitals: "チーム状態",
  tone: "傾向",
  spread: "横断",
  "journal-volume": "観測量",
  "stalled-suggestions": "未処理課題",
};

/** UI側で onSelect に配線する遷移先。core はコールバックを持たない。 */
export type SituationItemTarget = NextActionTarget;

export type SituationItem = {
  id: string;
  text: string;
  since: number;
  target?: SituationItemTarget;
  /** 気になる兆候／良い状態／評価できないことの表示色分けに使う。ステータス系以外の
   * カテゴリ（changes/comparisons/worthDeciding）では付けない。 */
  status?: VitalStatus;
  /** 状態チップのホバー詳細（根拠・件数等）。ユーザー指摘「色でわかるので名前だけで
   * 良い」対応でtextはチーム名／メンバー名だけにし、根拠はこちらへ逃がす。 */
  detail?: string;
  /** 状態チップの段落分け（チーム／メンバー）に使う。ユーザー指摘「チーム・メンバーが
   * 混合で並んでいる」対応。ステータス系以外のカテゴリでは付けない。 */
  entityKind?: "team" | "person";
  /** 気になる兆候カードの種別ラベル用。status付き個体チップとは別物。 */
  signalKind?: ConcernSignalKind;
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
const CATEGORY_LIMIT = 6;
const WORTH_DECIDING_LIMIT = 5;
/** Journal総件数が先週同期間の半分以下になる判定の、先週側の最低母数。 */
const JOURNAL_VOLUME_BASELINE_MIN = 4;
/** 週初の誤警報を避けるため、経過がこの日数未満なら量・傾向の先週比は出さない。 */
const WEEK_COMPARE_MIN_ELAPSED_DAYS = 2;
/** 停滞提案を「さばききれていない」とみなす最低件数。 */
const STALLED_SUGGESTIONS_MIN = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function countInWindow(entries: JournalEntry[], window: { start: number; end: number }): number {
  return entries.filter((e) => e.createdAt >= window.start && e.createdAt < window.end).length;
}

function countBySentiment(
  entries: JournalEntry[],
  window: { start: number; end: number },
  sentiment: JournalEntry["sentiment"],
): number {
  return entries.filter(
    (e) => e.createdAt >= window.start && e.createdAt < window.end && e.sentiment === sentiment,
  ).length;
}

type RankedConcern = SituationItem & { severity: number };

function buildOrgConcernSignals(params: {
  now: number;
  journalEntries: JournalEntry[];
  vitals: OrgVitals;
  people: PersonSummary[];
  suggestions: Suggestion[];
  staleInterventionDays: number;
}): SituationItem[] {
  const { now, journalEntries, vitals, people, suggestions, staleInterventionDays } = params;
  const ranked: RankedConcern[] = [];

  // S1: Vitals悪化の集約（個体チップは「注目」側。ここはパターン文章）。
  const badTeams = vitals.teams.filter((t) => t.status === "bad");
  const warnTeams = vitals.teams.filter((t) => t.status === "warn");
  const concerningTeams = [...badTeams, ...warnTeams];
  if (badTeams.length >= 1 || concerningTeams.length >= 2) {
    const names = concerningTeams.slice(0, 3).map((t) => t.teamName);
    const more = concerningTeams.length > 3 ? ` ほか${concerningTeams.length - 3}` : "";
    const focus = badTeams[0] ?? concerningTeams[0];
    ranked.push({
      id: "concern-vitals-teams",
      signalKind: "vitals",
      text:
        badTeams.length > 0
          ? `要注意のチームが${badTeams.length}つ（${names.join(" / ")}${more}）`
          : `やや注意以上のチームが${concerningTeams.length}つ（${names.join(" / ")}${more}）`,
      detail: concerningTeams.map((t) => `${t.teamName}: ${t.label}（${truncate(t.reason, 40)}）`).join(" ／ "),
      since: 0,
      target: { type: "path", path: `/teams?focus=${focus.teamId}` },
      severity: badTeams.length > 0 ? 100 : 80,
    });
  }
  const concerningPeople = people.filter((p) => {
    const status = personVitalStatus(p.trend, p.hasConcerningSuggestion);
    return status === "bad" || status === "warn";
  });
  if (concerningPeople.length >= 2) {
    const names = concerningPeople.slice(0, 3).map((p) => p.name);
    const more = concerningPeople.length > 3 ? ` ほか${concerningPeople.length - 3}名` : "";
    const worst = [...concerningPeople].sort((a, b) => {
      const sa = personVitalStatus(a.trend, a.hasConcerningSuggestion);
      const sb = personVitalStatus(b.trend, b.hasConcerningSuggestion);
      if (sa === "bad" && sb !== "bad") return -1;
      if (sb === "bad" && sa !== "bad") return 1;
      return b.trend.negative - a.trend.negative;
    })[0];
    ranked.push({
      id: "concern-vitals-people",
      signalKind: "vitals",
      text: `要注意寄りのメンバーが${concerningPeople.length}名（${names.join(" / ")}${more}）`,
      detail: concerningPeople
        .map((p) => {
          const status = personVitalStatus(p.trend, p.hasConcerningSuggestion);
          return `${p.name}: ${PERSON_VITAL_LABEL[status]}（🙂${p.trend.positive} 🙁${p.trend.negative}）`;
        })
        .join(" ／ "),
      since: 0,
      target: { type: "path", path: `/people/${worst.id}` },
      severity: concerningPeople.some((p) => personVitalStatus(p.trend, p.hasConcerningSuggestion) === "bad")
        ? 90
        : 70,
    });
  }

  // S5: 停滞した提案（さばききれていない課題）。
  const stalled = suggestions
    .filter((s) => !s.archivedAt && isSuggestionStalled(s, now, staleInterventionDays))
    .sort((a, b) => a.updatedAt - b.updatedAt);
  if (stalled.length >= STALLED_SUGGESTIONS_MIN) {
    const oldest = stalled[0];
    const days = Math.max(1, Math.round((now - oldest.updatedAt) / (24 * 60 * 60 * 1000)));
    ranked.push({
      id: "concern-stalled-suggestions",
      signalKind: "stalled-suggestions",
      text: `さばききれていない提案が${stalled.length}件（最長${days}日停滞）`,
      detail: stalled
        .slice(0, 3)
        .map((s) => s.title)
        .join(" ／ "),
      since: oldest.updatedAt,
      target: { type: "path", path: "/suggestions" },
      severity: 85,
    });
  }

  // S4 / S2: 先週比は「今週の経過分」と「先週の同じ経過分」で揃える。
  // 週初に今週全体 vs 先週全体を比べると、当たり前に少なく見えて誤警報になるため。
  const thisWeek = periodWindow("week", 0, now);
  const lastWeek = periodWindow("week", -1, now);
  const elapsedMs = Math.max(0, Math.min(now, thisWeek.end) - thisWeek.start);
  const elapsedDays = elapsedMs / DAY_MS;
  const thisSoFarWindow = { start: thisWeek.start, end: Math.min(now, thisWeek.end) };
  const lastSameElapsedWindow = { start: lastWeek.start, end: lastWeek.start + elapsedMs };

  if (elapsedDays >= WEEK_COMPARE_MIN_ELAPSED_DAYS) {
    // S4: Journal総件数の低下（観測できていない増加の兆候）。
    const thisSoFar = countInWindow(journalEntries, thisSoFarWindow);
    const lastSameElapsed = countInWindow(journalEntries, lastSameElapsedWindow);
    if (lastSameElapsed >= JOURNAL_VOLUME_BASELINE_MIN && thisSoFar * 2 <= lastSameElapsed) {
      ranked.push({
        id: "concern-journal-volume",
        signalKind: "journal-volume",
        text: `今週ここまでのJournalが${thisSoFar}件（先週同期間${lastSameElapsed}件）と観測量が落ちています`,
        detail: "記録量が減ると、組織で起きている変化を見逃しやすくなります",
        since: 0,
        target: { type: "path", path: "/journal" },
        severity: 75,
      });
    }

    // S2: 週次ネガ件数の悪化（チャートの「読み」一文）。同期間比較。
    const thisNegative = countBySentiment(journalEntries, thisSoFarWindow, "negative");
    const lastNegative = countBySentiment(journalEntries, lastSameElapsedWindow, "negative");
    if (thisNegative >= 2 && thisNegative > lastNegative) {
      ranked.push({
        id: "concern-tone-worsening",
        signalKind: "tone",
        text: `今週ここまでのネガティブJournalが${thisNegative}件（先週同期間${lastNegative}件）と増えています`,
        detail: "週次トーンの悪化。個別の出来事より、傾向として見る材料です",
        since: 0,
        severity: 65,
      });
    }
  }

  // S3: 横断・再発（同一チームにネガ傾向メンバーが複数／同一人物のネガ積み上がり）。
  const negativePeople = people.filter((p) => p.trend.negative >= 2 && p.trend.negative > p.trend.positive);
  const byTeam = new Map<string, PersonSummary[]>();
  for (const p of negativePeople) {
    const teamKey = p.teamNames[0] ?? "";
    if (!teamKey) continue;
    const list = byTeam.get(teamKey) ?? [];
    list.push(p);
    byTeam.set(teamKey, list);
  }
  const spreadTeams = [...byTeam.entries()]
    .filter(([, members]) => members.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  if (spreadTeams.length > 0) {
    const [teamName, members] = spreadTeams[0];
    ranked.push({
      id: `concern-spread-team-${teamName}`,
      signalKind: "spread",
      text: `${teamName}でネガ傾向のメンバーが${members.length}名（${members
        .slice(0, 3)
        .map((m) => m.name)
        .join(" / ")}）`,
      detail: members.map((m) => `${m.name}: 🙁${m.trend.negative}`).join(" ／ "),
      since: 0,
      target: { type: "path", path: `/people/${members[0].id}` },
      severity: 60,
    });
  }
  const heavyPerson = [...negativePeople].sort((a, b) => b.trend.negative - a.trend.negative)[0];
  if (heavyPerson && heavyPerson.trend.negative >= 3) {
    ranked.push({
      id: `concern-spread-person-${heavyPerson.id}`,
      signalKind: "spread",
      text: `${heavyPerson.name}にネガティブな記録が${heavyPerson.trend.negative}件積み上がっています`,
      detail: `${heavyPerson.name}: 🙂${heavyPerson.trend.positive} 🙁${heavyPerson.trend.negative} 😐${heavyPerson.trend.neutral}`,
      since: 0,
      target: { type: "path", path: `/people/${heavyPerson.id}` },
      severity: 55,
    });
  }

  return ranked
    .sort((a, b) => b.severity - a.severity || b.since - a.since)
    .map(({ severity: _severity, ...item }) => {
      void _severity;
      return item;
    });
}

export type BuildDailySituationParams = {
  now: number;
  journalEntries: JournalEntry[];
  vitals: OrgVitals;
  people: PersonSummary[];
  nextActions: NextAction[];
  /** 停滞提案の組織シグナル用。未指定時は空配列。 */
  suggestions?: Suggestion[];
  /** Settingsの停滞日数。未指定時は14日。 */
  staleInterventionDays?: number;
};

export function buildDailySituation(params: BuildDailySituationParams): DailySituation {
  const {
    now,
    journalEntries,
    vitals,
    people: allPeople,
    nextActions,
    suggestions = [],
    staleInterventionDays = 14,
  } = params;
  // docs/memo.md「今日の状況に表示するメンバーを自分の管理するチームのメンバーだけに
  // する」対応。ステータスチップ・比較欄で扱う「メンバー」は、自分が管理するチーム
  // （Team.managedByEm、兼務含む）に所属する人物（PersonSummary.isDirectReport）に限る。
  // 退職アーカイブ済みは既に活動していない人物として除外する。
  const people = allPeople.filter((p) => p.isDirectReport && !p.archived);

  // 1. 昨日から変わったこと: 直近24時間に記録されたJournal。
  const changes: SituationItem[] = journalEntries
    .filter((e) => now - e.createdAt <= CHANGES_WINDOW_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, CATEGORY_LIMIT)
    .map((e) => ({
      id: `changes-journal-${e.id}`,
      text: truncate(e.summary || e.rawText, 60),
      since: e.createdAt,
      target: { type: "path" as const, path: `/journal?focus=${e.id}` },
    }));

  // 2. 気になる兆候: 組織レベルのパターン材料（Vitals集約・傾向・横断・観測量・停滞提案）。
  // 緊急Journalの個別トリアージや、warn/bad個体チップは「今日やるべきこと」「注目」側。
  const concerns = buildOrgConcernSignals({
    now,
    journalEntries,
    vitals,
    people,
    suggestions,
    staleInterventionDays,
  });

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
      target: { type: "path", path: "/teams" },
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
        target: { type: "path", path: `/teams?focus=${t.teamId}` },
        status: "good",
        entityKind: "team",
      });
    }
  }
  for (const p of people) {
    if (personVitalStatus(p.trend, p.hasConcerningSuggestion) === "good") {
      good.push({
        id: `good-person-${p.id}`,
        text: p.name,
        detail: `${p.name}: ${PERSON_VITAL_LABEL.good}（🙂${p.trend.positive} 🙁${p.trend.negative}）`,
        since: 0,
        target: { type: "path", path: `/people/${p.id}` },
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
      target: {
        type: "prefill-journal",
        text: uncovered[0] ? `#1on1 @${uncovered[0]} ` : "",
      },
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
        target: { type: "path", path: `/teams?focus=${t.teamId}` },
        status: "unknown",
        entityKind: "team",
      });
    }
  }
  for (const p of people) {
    if (personVitalStatus(p.trend, p.hasConcerningSuggestion) === "unknown") {
      unevaluable.push({
        id: `unevaluable-person-${p.id}`,
        text: p.name,
        detail: `${p.name}: ${PERSON_VITAL_LABEL.unknown}`,
        since: 0,
        target: { type: "path", path: `/people/${p.id}` },
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
  const thisNegative = countBySentiment(journalEntries, thisWeek, "negative");
  const lastNegative = countBySentiment(journalEntries, lastWeek, "negative");
  const thisPositive = countBySentiment(journalEntries, thisWeek, "positive");
  const lastPositive = countBySentiment(journalEntries, lastWeek, "positive");
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
    target: a.target,
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

// docs/2nd_pivot_version.md Phase 1対応。「Issueが何件あるか」ではなく、
// docs/2nd_pivot_version/pivot_policy.md「目指すUX」の6項目
// （昨日から変わったこと／気になる兆候／良い状態／評価できないこと／過去との比較／
// 判断する価値がありそうなこと）でEMに状況を提示するための純粋関数群。
// この段階ではIssueの内部データモデルには触れず、既にクライアント側で取得済みの
// Journal / Vitals / People / KnowledgeEvent(interpretation) / NextActionsだけを
// 組み替えて使う（新しいAPI・永続化エンティティは追加しない）。
import { periodWindow } from "@/lib/daily-trends";
import type { NextAction } from "@/lib/dashboard-next-actions";
import { PERSON_VITAL_LABEL, personVitalStatus, isJournalEntryResolved } from "@/lib/types";
import type { JournalEntry, OrgVitals, PersonSummary, VitalStatus } from "@/lib/types";

// 「つながりを見る」等の詳細表示と違い、ここでは要約だけを扱うため、
// サーバー側KnowledgeEvent（knowledge-store.ts）のうち使うフィールドだけの軽量な型にする。
export type InterpretationEvent = {
  id: string;
  text: string;
  tags: string[];
  people: string[];
  occurredAt: number;
};

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
  interpretations: InterpretationEvent[];
  nextActions: NextAction[];
  push: (path: string) => void;
};

export function buildDailySituation(params: BuildDailySituationParams): DailySituation {
  const { now, journalEntries, vitals, people, interpretations, nextActions, push } = params;

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
  if (vitals.oneOnOneCoverage.status === "bad" || vitals.oneOnOneCoverage.status === "warn") {
    unevaluable.push({
      id: "unevaluable-coverage",
      text: "1on1 Coverage",
      detail: `1on1 Coverageが${vitals.oneOnOneCoverage.covered}/${vitals.oneOnOneCoverage.total}件と少なく、観測が不足しています`,
      since: 0,
      onSelect: () => push("/teams"),
      status: vitals.oneOnOneCoverage.status,
      entityKind: "team",
    });
  }

  // 5. 過去との比較: 今週と先週のJournal件数比較（量的比較） + 気になる人物についての
  // 既存の長期解釈（KnowledgeEvent kind:interpretation、質的比較）。
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
  const concernedPeopleNames = new Set(
    people
      .filter((p) => {
        const s = personVitalStatus(p.trend, p.hasConcerningIssue);
        return s === "bad" || s === "warn";
      })
      .flatMap((p) => [p.name, ...p.aliases]),
  );
  const relatedInterpretations = interpretations
    .filter((i) => i.people.some((name) => concernedPeopleNames.has(name)))
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, CATEGORY_LIMIT - comparisons.length);
  for (const i of relatedInterpretations) {
    comparisons.push({
      id: `comparison-interpretation-${i.id}`,
      text: truncate(i.text, 70),
      since: i.occurredAt,
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

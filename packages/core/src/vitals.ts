import { getTeam, listActiveTeams, type Team } from "./org-context-store/index";
import { isPersonArchived } from "./people-directory";
import { getRulesAndConstraints, getSelfPersonId } from "./settings-store";
import { listJournalEntries, type JournalEntry, isJournalRelatedToTeam } from "./journal-store";
import { isSuggestionStalled, teamDisplayName } from "./types";
import { listSuggestions } from "./suggestion-store";
import type { Suggestion } from "./types";

// Team Vitalsの三値ステータス（良好/要注意/評価不能）を実データから算出する。
// 重要: データが足りない場合に「良好」や「要注意」へ寄せず、必ず"unknown"として
// 判定不能であることを明示する。

export type VitalStatus = "good" | "warn" | "bad" | "unknown";

export type TeamVital = {
  teamId: string;
  teamName: string;
  status: VitalStatus;
  label: string;
  reason: string;
  // 評価不能な時にEMが誰の1on1を
  // 記録すればよいか具体的に示せるよう、チームメンバー（PERSON_n IDのまま）を持たせる。
  // 実名への変換はAPIルート側（unmaskNames）で行う。
  members: string[];
  // Dashboardの「○○さんの1on1を記録」提案を、自分が管理するチームに限定するために使う。
  managedByEm: boolean;
};

export type CoverageVital = {
  status: VitalStatus;
  covered: number;
  total: number;
  reason: string;
  // reasonの自由文からのパースは脆いため、1on1が未実施の
  // メンバー（PERSON_n ID）を構造化フィールドとして持たせる。
  uncoveredMembers: string[];
};

export type OrgVitals = {
  teams: TeamVital[];
  oneOnOneCoverage: CoverageVital;
};

function withinDays(ts: number, days: number): boolean {
  return Date.now() - ts <= days * 24 * 60 * 60 * 1000;
}

function sentimentScore(s: JournalEntry["sentiment"]): number {
  if (s === "positive") return 1;
  if (s === "negative") return -1;
  return 0;
}

const STATUS_LABEL: Record<VitalStatus, string> = { good: "安定", warn: "やや注意", bad: "要注意", unknown: "評価不能" };

// Journalのsentimentだけで判定すると、提案が停滞・確認保留していても穏やかに見えてしまう。
// このチームに紐づく（Suggestion.teamId一致）未アーカイブ提案に、確認保留・停滞中のものが
// 1件でもあるかを見る。
function hasConcerningTeamSuggestion(teamId: string, now: number, staleDays: number): boolean {
  return listSuggestions().some(
    (s) =>
      s.teamId === teamId &&
      !s.archivedAt &&
      (s.reviewStatus === "deferred" || isSuggestionStalled(s, now, staleDays)),
  );
}

function computeTeamVital(team: Team, entries: JournalEntry[], rules: ReturnType<typeof getRulesAndConstraints>): TeamVital {
  const concerning = hasConcerningTeamSuggestion(team.id, Date.now(), rules.staleInterventionDays);
  // 1on1記録CTA向け。利用者本人は「EMが1on1を実施すべき相手」ではないので除外する。
  // 退職アーカイブ済みも同様に除外する。
  const selfPersonId = getSelfPersonId();
  const membersForAction = team.members.filter(
    (m) => m !== selfPersonId && !isPersonArchived(m),
  );
  // hasConcerningSuggestionがtrueの場合、Journal起因の判定が"good"/"unknown"でも"warn"以上に
  // 引き上げる（"warn"/"bad"は据え置き＝提案の状況で評価を下げることはあっても甘くはしない）。
  function withSuggestionEscalation(status: VitalStatus, reason: string): { status: VitalStatus; label: string; reason: string } {
    if (concerning && (status === "good" || status === "unknown")) {
      return {
        status: "warn",
        label: STATUS_LABEL.warn,
        reason: `${reason}停滞中または確認保留の関連提案があるため「やや注意」に引き上げています。`,
      };
    }
    return { status, label: STATUS_LABEL[status], reason };
  }

  if (team.members.length === 0) {
    // メンバー未登録でも、明示 teamIds で紐付いた Journal があれば評価材料にする（方針A）。
    const linkedOnly = entries.filter(
      (e) => withinDays(e.createdAt, rules.teamWindowDays) && (e.teamIds ?? []).includes(team.id) && !e.noActionNeededAt,
    );
    if (linkedOnly.length < rules.minEntriesForJudgement) {
      return {
        teamId: team.id,
        teamName: teamDisplayName(team.name),
        ...withSuggestionEscalation(
          "unknown",
          linkedOnly.length === 0
            ? "メンバーが登録されていません。メンバータブでチームにメンバーを追加してください。"
            : `メンバー未登録のため、明示紐付けのJournal${linkedOnly.length}件だけでは判定材料が不足しています（情報不足）。`,
        ),
        members: membersForAction,
        managedByEm: team.managedByEm,
      };
    }
    // 明示紐付けだけで閾値に達した場合は下の sentiment 判定へ進む。
  }

  // 方針A: 明示 teamIds またはメンバー一致のどちらか。
  const relevant = entries.filter(
    (e) => withinDays(e.createdAt, rules.teamWindowDays) && isJournalRelatedToTeam(e, team) && !e.noActionNeededAt,
  );

  if (relevant.length < rules.minEntriesForJudgement) {
    return {
      teamId: team.id,
      teamName: teamDisplayName(team.name),
      ...withSuggestionEscalation(
        "unknown",
        `直近${rules.teamWindowDays}日間に${teamDisplayName(team.name)}のメンバーに関するジャーナルが${relevant.length}件しかなく、判定に必要な材料が不足しています（情報不足）。`,
      ),
      members: membersForAction,
      managedByEm: team.managedByEm,
    };
  }

  const positive = relevant.filter((e) => e.sentiment === "positive").length;
  const negative = relevant.filter((e) => e.sentiment === "negative").length;
  const avg = relevant.reduce((sum, e) => sum + sentimentScore(e.sentiment), 0) / relevant.length;

  let status: VitalStatus;
  if (avg <= rules.teamBadSentimentMax) {
    status = "bad";
  } else if (avg < rules.teamWarnSentimentMax) {
    status = "warn";
  } else {
    status = "good";
  }

  return {
    teamId: team.id,
    teamName: teamDisplayName(team.name),
    ...withSuggestionEscalation(
      status,
      `直近${rules.teamWindowDays}日間のジャーナル${relevant.length}件（ポジティブ${positive}件 / ネガティブ${negative}件）に基づく簡易判定です。件数が少ないうちは参考程度に見てください。`,
    ),
    members: membersForAction,
    managedByEm: team.managedByEm,
  };
}

function computeCoverageVital(
  teams: Team[],
  entries: JournalEntry[],
  rules: ReturnType<typeof getRulesAndConstraints>,
): CoverageVital {
  // 1on1 Coverageは「EMが1on1を実施すべき相手」の充足率なので、自分が管理するチーム
  // （managedByEm）のメンバーだけを対象にする（兼務で他チームにも所属していれば対象に含む）。
  // さらに利用者本人(selfPersonId)と退職アーカイブ済みは「1on1を実施すべき相手」ではないので除外する。
  const selfPersonId = getSelfPersonId();
  const allMembers = Array.from(
    new Set(
      teams
        .filter((t) => t.managedByEm)
        .flatMap((t) => t.members)
        .filter((m) => m !== selfPersonId && !isPersonArchived(m)),
    ),
  );
  if (allMembers.length === 0) {
    return {
      status: "unknown",
      covered: 0,
      total: 0,
      reason: "自分が管理するチーム・メンバーが登録されていないため算出できません。",
      uncoveredMembers: [],
    };
  }

  const covered = new Set<string>();
  for (const e of entries) {
    if (!withinDays(e.createdAt, rules.coverageWindowDays)) continue;
    const is1on1 = e.tags.some((t) => t.includes("1on1") || t.includes("1 on 1") || t.includes("１on１"));
    if (!is1on1) continue;
    for (const p of e.people) {
      if (allMembers.includes(p)) covered.add(p);
    }
  }

  const total = allMembers.length;
  const coveredCount = covered.size;
  const ratio = coveredCount / total;
  const status: VitalStatus =
    ratio >= rules.coverageGoodRatio ? "good" : ratio >= rules.coverageWarnRatio ? "warn" : "bad";

  return {
    status,
    covered: coveredCount,
    total,
    reason: `直近${rules.coverageWindowDays}日間に#1on1系タグの付いたジャーナルで言及されたメンバー数 / 登録メンバー総数。`,
    uncoveredMembers: allMembers.filter((m) => !covered.has(m)),
  };
}

export function computeOrgVitals(): OrgVitals {
  const teams = listActiveTeams();
  // 1on1 Coverage と同様、Dashboard / 朝サマリー / 次にすべきことの Team Vitals は
  // managedByEm のチームだけを対象にする（兼務・他チームの観測は /teams 側で管理）。
  const managedTeams = teams.filter((t) => t.managedByEm);
  const entries = listJournalEntries();
  const rules = getRulesAndConstraints();
  return {
    teams: managedTeams.map((t) => computeTeamVital(t, entries, rules)),
    oneOnOneCoverage: computeCoverageVital(teams, entries, rules),
  };
}

// 「感覚」ではなく観測（Journalのsentiment集計）に基づいて、介入（チームに紐づく提案）の
// 前後でチームの状態がどう変化したかを見せる。新しいVitalsのロジックは作らず、
// computeTeamVitalと同じ「直近teamWindowDays日間のJournal」という考え方を、
// 「解決（done）前のteamWindowDays日間」と「reviewedAt以降のteamWindowDays日間」の
// 2つの窓に分けて適用するだけ。
// 未完了でも
// before窓（介入開始前）と「介入開始〜現在」窓の比較を返す（inProgressで文言を出し分け）。
export type ImpactWindow = { total: number; positive: number; negative: number };
export type SuggestionImpact = { windowDays: number; before: ImpactWindow; after: ImpactWindow; inProgress: boolean };

function summarizeWindow(entries: JournalEntry[]): ImpactWindow {
  return {
    total: entries.length,
    positive: entries.filter((e) => e.sentiment === "positive").length,
    negative: entries.filter((e) => e.sentiment === "negative").length,
  };
}

// チームに紐づいていない提案には「介入の前後比較」という概念自体が成立しないため、
// その場合はundefinedを返す（呼び出し側はCTAを出し分ける）。
export function computeSuggestionImpact(suggestion: Suggestion): SuggestionImpact | undefined {
  if (!suggestion.teamId) return undefined;
  const team = getTeam(suggestion.teamId);
  if (!team) return undefined;

  const rules = getRulesAndConstraints();
  const windowMs = rules.teamWindowDays * 24 * 60 * 60 * 1000;
  const entries = listJournalEntries();
  // 方針A: 明示 teamIds またはメンバー一致。メンバー0人でも明示紐付けがあれば比較できる。
  const relevant = entries.filter((e) => isJournalRelatedToTeam(e, team));

  const beforeEntries = relevant.filter(
    (e) => e.createdAt >= suggestion.createdAt - windowMs && e.createdAt < suggestion.createdAt,
  );

  if (suggestion.reviewStatus === "done" && suggestion.reviewedAt) {
    const afterEntries = relevant.filter(
      (e) => e.createdAt >= suggestion.reviewedAt! && e.createdAt < suggestion.reviewedAt! + windowMs,
    );
    return { windowDays: rules.teamWindowDays, before: summarizeWindow(beforeEntries), after: summarizeWindow(afterEntries), inProgress: false };
  }

  // 進行中: 「解決後の固定windowDays日間」がまだ存在しないため、代わりに
  // 「介入開始（提案作成）〜現在」を観測窓とする。
  const sinceStartEntries = relevant.filter((e) => e.createdAt >= suggestion.createdAt && e.createdAt <= Date.now());
  return { windowDays: rules.teamWindowDays, before: summarizeWindow(beforeEntries), after: summarizeWindow(sinceStartEntries), inProgress: true };
}

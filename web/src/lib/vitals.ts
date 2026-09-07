import { getTeam, listActiveTeams, type Team } from "@/lib/org-context-store";
import { getRulesAndConstraints } from "@/lib/settings-store";
import { listJournalEntries, type JournalEntry } from "@/lib/journal-store";
import { teamDisplayName } from "@/lib/types";
import type { Issue } from "@/lib/issue-store";

// docs 3.1.1「Team Vitals」の三値ステータス（良好/要注意/評価不能）を実データから算出する。
// 重要: データが足りない場合に「良好」や「要注意」へ寄せず、必ず"unknown"として
// 判定不能であることを明示する（このプロジェクトの出発点になった要件）。

export type VitalStatus = "good" | "warn" | "bad" | "unknown";

export type TeamVital = {
  teamId: string;
  teamName: string;
  status: VitalStatus;
  label: string;
  reason: string;
  // docs/memo.md「D. 評価不能→観測アクション」対応。評価不能な時にEMが誰の1on1を
  // 記録すればよいか具体的に示せるよう、チームメンバー（PERSON_n IDのまま）を持たせる。
  // 実名への変換はAPIルート側（unmaskNames）で行う。
  members: string[];
};

export type CoverageVital = {
  status: VitalStatus;
  covered: number;
  total: number;
  reason: string;
  // docs/memo.md「D」対応。reasonの自由文からのパースは脆いため、1on1が未実施の
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

function computeTeamVital(team: Team, entries: JournalEntry[], rules: ReturnType<typeof getRulesAndConstraints>): TeamVital {
  if (team.members.length === 0) {
    return {
      teamId: team.id,
      teamName: teamDisplayName(team.name),
      status: "unknown",
      label: "評価不能",
      reason: "メンバーが登録されていません。Organization Contextでメンバーを追加してください。",
      members: team.members,
    };
  }

  const relevant = entries.filter(
    (e) => withinDays(e.createdAt, rules.teamWindowDays) && e.people.some((p) => team.members.includes(p)),
  );

  if (relevant.length < rules.minEntriesForJudgement) {
    return {
      teamId: team.id,
      teamName: teamDisplayName(team.name),
      status: "unknown",
      label: "評価不能",
      reason: `直近${rules.teamWindowDays}日間に${teamDisplayName(team.name)}のメンバーに関するジャーナルが${relevant.length}件しかなく、判定に必要な材料が不足しています（情報不足）。`,
      members: team.members,
    };
  }

  const positive = relevant.filter((e) => e.sentiment === "positive").length;
  const negative = relevant.filter((e) => e.sentiment === "negative").length;
  const avg = relevant.reduce((sum, e) => sum + sentimentScore(e.sentiment), 0) / relevant.length;

  let status: VitalStatus;
  let label: string;
  if (avg <= rules.teamBadSentimentMax) {
    status = "bad";
    label = "要注意";
  } else if (avg < rules.teamWarnSentimentMax) {
    status = "warn";
    label = "やや注意";
  } else {
    status = "good";
    label = "安定";
  }

  return {
    teamId: team.id,
    teamName: teamDisplayName(team.name),
    status,
    label,
    reason: `直近${rules.teamWindowDays}日間のジャーナル${relevant.length}件（ポジティブ${positive}件 / ネガティブ${negative}件）に基づく簡易判定です。件数が少ないうちは参考程度に見てください。`,
    members: team.members,
  };
}

function computeCoverageVital(
  teams: Team[],
  entries: JournalEntry[],
  rules: ReturnType<typeof getRulesAndConstraints>,
): CoverageVital {
  const allMembers = Array.from(new Set(teams.flatMap((t) => t.members)));
  if (allMembers.length === 0) {
    return {
      status: "unknown",
      covered: 0,
      total: 0,
      reason: "チーム・メンバーが登録されていないため算出できません。",
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
  const entries = listJournalEntries();
  const rules = getRulesAndConstraints();
  return {
    teams: teams.map((t) => computeTeamVital(t, entries, rules)),
    oneOnOneCoverage: computeCoverageVital(teams, entries, rules),
  };
}

// docs/memo.md「L. 介入の閉ループ（やった→組織が変わったか）」対応。
// 「感覚」ではなく観測（Journalのsentiment集計）に基づいて、介入（チームに紐づくIssueの
// アーカイブ）の前後でチームの状態がどう変化したかを見せる。新しいVitalsのロジックは
// 作らず、computeTeamVitalと同じ「直近teamWindowDays日間のJournal」という考え方を、
// 「アーカイブ前のteamWindowDays日間」と「アーカイブ後のteamWindowDays日間」の
// 2つの窓に分けて適用するだけ。
// docs/em_human_story_and_ux.md P2-15「介入効果の『進行中』版」対応。以前はアーカイブ後
// にしか意味を持たなかったが、EMが「今進めている介入が観測できているか」を完了を待たずに
// 確認できるよう、未アーカイブでもbefore窓（介入開始前）と「介入開始〜現在」窓の比較を返す
// ようにした（inProgressで呼び出し側が見出し・文言を出し分ける）。
export type ImpactWindow = { total: number; positive: number; negative: number };
export type IssueImpact = { windowDays: number; before: ImpactWindow; after: ImpactWindow; inProgress: boolean };

function summarizeWindow(entries: JournalEntry[]): ImpactWindow {
  return {
    total: entries.length,
    positive: entries.filter((e) => e.sentiment === "positive").length,
    negative: entries.filter((e) => e.sentiment === "negative").length,
  };
}

// チームに紐づいていないIssueには「介入の前後比較」という概念自体が成立しないため、
// その場合はundefinedを返す（呼び出し側はCTAを出し分ける）。
export function computeIssueImpact(issue: Issue): IssueImpact | undefined {
  if (!issue.teamId) return undefined;
  const team = getTeam(issue.teamId);
  if (!team || team.members.length === 0) return undefined;

  const rules = getRulesAndConstraints();
  const windowMs = rules.teamWindowDays * 24 * 60 * 60 * 1000;
  const entries = listJournalEntries();
  const relevant = entries.filter((e) => e.people.some((p) => team.members.includes(p)));

  const beforeEntries = relevant.filter((e) => e.createdAt >= issue.createdAt - windowMs && e.createdAt < issue.createdAt);

  if (issue.archived && issue.archivedAt) {
    const afterEntries = relevant.filter((e) => e.createdAt >= issue.archivedAt! && e.createdAt < issue.archivedAt! + windowMs);
    return { windowDays: rules.teamWindowDays, before: summarizeWindow(beforeEntries), after: summarizeWindow(afterEntries), inProgress: false };
  }

  // 進行中: 「アーカイブ後の固定windowDays日間」がまだ存在しないため、代わりに
  // 「介入開始（Issue作成）〜現在」を観測窓とする（完了を待たずに観測不足に気づけるように）。
  const sinceStartEntries = relevant.filter((e) => e.createdAt >= issue.createdAt && e.createdAt <= Date.now());
  return { windowDays: rules.teamWindowDays, before: summarizeWindow(beforeEntries), after: summarizeWindow(sinceStartEntries), inProgress: true };
}

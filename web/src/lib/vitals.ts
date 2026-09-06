import { listActiveTeams, type Team } from "@/lib/org-context-store";
import { getRulesAndConstraints } from "@/lib/settings-store";
import { listJournalEntries, type JournalEntry } from "@/lib/journal-store";

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
};

export type CoverageVital = {
  status: VitalStatus;
  covered: number;
  total: number;
  reason: string;
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
      teamName: team.name,
      status: "unknown",
      label: "評価不能",
      reason: "メンバーが登録されていません。Organization Contextでメンバーを追加してください。",
    };
  }

  const relevant = entries.filter(
    (e) => withinDays(e.createdAt, rules.teamWindowDays) && e.people.some((p) => team.members.includes(p)),
  );

  if (relevant.length < rules.minEntriesForJudgement) {
    return {
      teamId: team.id,
      teamName: team.name,
      status: "unknown",
      label: "評価不能",
      reason: `直近${rules.teamWindowDays}日間に${team.name}のメンバーに関するジャーナルが${relevant.length}件しかなく、判定に必要な材料が不足しています（情報不足）。`,
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
    teamName: team.name,
    status,
    label,
    reason: `直近${rules.teamWindowDays}日間のジャーナル${relevant.length}件（ポジティブ${positive}件 / ネガティブ${negative}件）に基づく簡易判定です。件数が少ないうちは参考程度に見てください。`,
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

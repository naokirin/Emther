import { Hono } from "hono";
import type { VitalsResponse } from "@emther/api-contract";
import { computeOrgVitals } from "@emther/core/vitals";
import { unmaskNames } from "@emther/core/people-directory";

// docs/2nd_architecture/plan.md フェーズ2.3: web/src/app/api/vitals/route.ts の移植。
// docs/memo.md「D. 評価不能→観測アクション」対応。vitals.tsのmembers/uncoveredMembersは
// 個人情報分離のためPERSON_n IDのまま保持しているので、EM向け応答の境界であるここで
// 実名へ復元する（toRunView/toIssueViewと同じ設計方針）。
export const vitalsRoute = new Hono().get("/", (c) => {
  const vitals = computeOrgVitals();
  const body = {
    teams: vitals.teams.map((t) => ({ ...t, members: t.members.map(unmaskNames) })),
    oneOnOneCoverage: {
      ...vitals.oneOnOneCoverage,
      uncoveredMembers: vitals.oneOnOneCoverage.uncoveredMembers.map(unmaskNames),
    },
  } satisfies VitalsResponse;
  return c.json(body);
});

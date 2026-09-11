import { listRecentChangeEvents, toEventView, type KnowledgeEntityType } from "@/lib/knowledge-store";
import { getIssue, toIssueView } from "@/lib/issue-store";
import {
  getTeam,
  getObjective,
  getOrgBackground,
  toObjectiveView,
  toOrgBackgroundView,
} from "@/lib/org-context-store";
import { teamDisplayName } from "@/lib/types";

// docs/memo.md「N. 時系列変化をEMが読む物語に」対応。新しいエンティティやデータモデルは
// 増やさず、既存のKnowledgeEvent（変更履歴）をIssue/Team/Objective横断で1本の
// タイムラインとして見せるだけの集約レイヤー（people-hub.tsと同じ考え方）。

export type TimelineEntry = {
  id: string;
  entityType: KnowledgeEntityType;
  entityId?: string;
  // このイベントが指すエンティティの現在の表示名。エンティティが削除済みの場合はundefined
  // （呼び出し側は「(削除済み)」等で扱う）。
  entityLabel?: string;
  // IssueはentityIdへ直接リンクできるが、Team/Objectiveは/org側が選択状態をURLで
  // 持たないため、リンク自体は/orgへの遷移に留める（新規画面は増やさない）。
  href?: string;
  text: string;
  occurredAt: number;
};

export const ENTITY_TYPE_LABEL: Record<KnowledgeEntityType, string> = {
  issue: "Issue",
  team: "Team",
  org: "Org",
  journal: "Journal",
  person: "Person",
};

// 個人情報の分離: title/nameはentity種別によって「保存時にマスク済み（要unmask）」か
// 「元々マスク対象外（team.name）」かが異なるため、それぞれの既存のtoXxxView境界に
// 揃えてここで復元する。
function resolveEntity(entityType: KnowledgeEntityType, entityId: string): { label?: string; href?: string } {
  if (entityType === "issue") {
    const issue = getIssue(entityId);
    return issue ? { label: toIssueView(issue).title, href: `/issues/${issue.id}` } : {};
  }
  if (entityType === "team") {
    // チーム名は個人名ではないため元々マスク対象外（org-context-store.tsの設計）。
    const team = getTeam(entityId);
    return team ? { label: teamDisplayName(team.name), href: "/org" } : {};
  }
  if (entityType === "org") {
    const objective = getObjective(entityId);
    if (objective) return { label: toObjectiveView(objective).title, href: "/org" };
    const background = getOrgBackground(entityId);
    if (background) return { label: toOrgBackgroundView(background).title, href: "/org" };
  }
  return {};
}

export function listTimelineEntries(limit = 100): TimelineEntry[] {
  return listRecentChangeEvents(limit).map((raw) => {
    const event = toEventView(raw);
    const { label, href } = event.entityId ? resolveEntity(event.entityType, event.entityId) : {};
    return {
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      entityLabel: label,
      href,
      text: event.text,
      occurredAt: event.occurredAt,
    };
  });
}

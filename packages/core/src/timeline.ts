import { listRecentChangeEvents, toEventView, type KnowledgeEntityType } from "./knowledge-store";
import { getSuggestion, toSuggestionView } from "./suggestion-store";
import {
  getTeam,
  getGoal,
  getOrgBackground,
  toGoalView,
  toOrgBackgroundView,
} from "./org-context-store/index";
import { teamDisplayName } from "./types";

// 新しいエンティティやデータモデルは
// 増やさず、既存のKnowledgeEvent（変更履歴）をSuggestion/Team/Goal横断で1本の
// タイムラインとして見せるだけの集約レイヤー（people-hub.tsと同じ考え方）。

export type TimelineEntry = {
  id: string;
  entityType: KnowledgeEntityType;
  entityId?: string;
  // このイベントが指すエンティティの現在の表示名。エンティティが削除済みの場合はundefined
  // （呼び出し側は「(削除済み)」等で扱う）。
  entityLabel?: string;
  // SuggestionはentityIdへ直接リンクできる。Teamは /teams?focus= へ（方針・目標ではなくチーム管理側）。
  href?: string;
  text: string;
  occurredAt: number;
};

export const ENTITY_TYPE_LABEL: Record<KnowledgeEntityType, string> = {
  suggestion: "提案",
  team: "Team",
  org: "Org",
  journal: "Journal",
  person: "Person",
};

// 個人情報の分離: title/nameはentity種別によって「保存時にマスク済み（要unmask）」か
// 「元々マスク対象外（team.name）」かが異なるため、それぞれの既存のtoXxxView境界に
// 揃えてここで復元する。
function resolveEntity(entityType: KnowledgeEntityType, entityId: string): { label?: string; href?: string } {
  if (entityType === "suggestion") {
    const suggestion = getSuggestion(entityId);
    return suggestion ? { label: toSuggestionView(suggestion).title, href: `/suggestions/${suggestion.id}` } : {};
  }
  if (entityType === "team") {
    // チーム名は個人名ではないため元々マスク対象外（org-context-store.tsの設計）。
    const team = getTeam(entityId);
    return team ? { label: teamDisplayName(team.name), href: `/teams?focus=${encodeURIComponent(team.id)}` } : {};
  }
  if (entityType === "org") {
    const goal = getGoal(entityId);
    if (goal) {
      return { label: toGoalView(goal).title, href: "/org" };
    }
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

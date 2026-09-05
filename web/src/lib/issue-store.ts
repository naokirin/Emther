import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";

// docs 3.7「双方向のIssueトラッキング基盤」の最小実装。
// v5設計書はIssueが独自の実行計画・ロードマップを持つ想定だが、MVPでは
// 「Yieldと壁打ちチャットはAgent Runにそのまま委譲し、Issueは
//  タイトルとAction Itemsチェックリストだけを永続的に持つ薄いラッパー」にしている。
// agentRunIdが無いIssue（EMが直接起票）と、既存のAgent Runに紐づくIssue
// （AIのYieldをEMがIssue化したもの）の両方を許容するのが「双方向性」に対応する部分。

export type ActionItem = {
  id: string;
  text: string;
  done: boolean;
};

export type Issue = {
  id: string;
  title: string;
  agentRunId?: string;
  actionItems: ActionItem[];
  createdAt: number;
  updatedAt: number;
};

const issues: Issue[] = loadJSON<Issue[]>("issues.json", []);

function persist(): void {
  saveJSON("issues.json", issues);
}

export function listIssues(): Issue[] {
  return [...issues].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getIssue(id: string): Issue | undefined {
  return issues.find((i) => i.id === id);
}

export function createIssue(title: string, agentRunId?: string): Issue {
  const now = Date.now();
  const issue: Issue = {
    id: randomUUID(),
    title: title.trim(),
    agentRunId,
    actionItems: [],
    createdAt: now,
    updatedAt: now,
  };
  issues.push(issue);
  persist();
  return issue;
}

export function addActionItem(issueId: string, text: string): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return issue;
  issue.actionItems.push({ id: randomUUID(), text: trimmed, done: false });
  issue.updatedAt = Date.now();
  persist();
  return issue;
}

export function toggleActionItem(issueId: string, itemId: string): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const item = issue.actionItems.find((a) => a.id === itemId);
  if (!item) return undefined;
  item.done = !item.done;
  issue.updatedAt = Date.now();
  persist();
  return issue;
}

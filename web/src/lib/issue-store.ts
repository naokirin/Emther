import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";

// docs 3.7「双方向のIssueトラッキング基盤」の最小実装。
// v5設計書はIssueが独自の実行計画・ロードマップを持つ想定だが、MVPでは
// 「Yieldと壁打ちチャットはAgent Runにそのまま委譲し、Issueは
//  タイトル・Why/What/How・Action Itemsチェックリストだけを永続的に持つ薄いラッパー」にしている。
// agentRunIdが無いIssue（EMが直接起票）と、既存のAgent Runに紐づくIssue
// （AIのYieldをEMがIssue化したもの）の両方を許容するのが「双方向性」に対応する部分。

export type ActionItem = {
  id: string;
  text: string;
  done: boolean;
};

// Issueは重要な意思決定の単位であり、計画・実行の前に
// 「Why（生む価値・誰のため・なぜ今か）」「What（何を・どこまで・どのくらい・完了の定義）」
// 「How（どのように・なぜその方法か・前提と制約）」を明らかにしておくべき、という要求に対応。
// 各項目は空文字列（＝未整理）を許容する——分からないことを分からないまま隠さず、
// 「まだ明らかになっていない」を明示できるようにするのが狙い（Team Vitalsの評価不能と同じ考え方）。
export type IssueCharter = {
  why: string;
  what: string;
  how: string;
};

export type Issue = {
  id: string;
  title: string;
  agentRunId?: string;
  charter: IssueCharter;
  actionItems: ActionItem[];
  createdAt: number;
  updatedAt: number;
};

function emptyCharter(): IssueCharter {
  return { why: "", what: "", how: "" };
}

// 永続化ファイルに旧バージョン（charterフィールド追加前）のIssueが残っていても
// 壊れないよう、読み込み時に補完する。
const issues: Issue[] = loadJSON<Issue[]>("issues.json", []).map((issue) => ({
  ...issue,
  charter: issue.charter ?? emptyCharter(),
}));

function persist(): void {
  saveJSON("issues.json", issues);
}

export function listIssues(): Issue[] {
  return [...issues].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getIssue(id: string): Issue | undefined {
  return issues.find((i) => i.id === id);
}

export function createIssue(title: string, agentRunId?: string, charter?: Partial<IssueCharter>): Issue {
  const now = Date.now();
  const issue: Issue = {
    id: randomUUID(),
    title: title.trim(),
    agentRunId,
    charter: {
      why: charter?.why?.trim() ?? "",
      what: charter?.what?.trim() ?? "",
      how: charter?.how?.trim() ?? "",
    },
    actionItems: [],
    createdAt: now,
    updatedAt: now,
  };
  issues.push(issue);
  persist();
  return issue;
}

export function updateIssueCharter(issueId: string, patch: Partial<IssueCharter>): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  issue.charter = {
    why: patch.why !== undefined ? patch.why.trim() : issue.charter.why,
    what: patch.what !== undefined ? patch.what.trim() : issue.charter.what,
    how: patch.how !== undefined ? patch.how.trim() : issue.charter.how,
  };
  issue.updatedAt = Date.now();
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

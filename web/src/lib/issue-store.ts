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

// 親子関係は1階層のみ（孫Issue禁止）。docs 3.8「動的Issue実行管理」のズームイン/アウトの
// 最小実装で、複雑さを避けるため「親（トップレベル）」と「子（サブIssue）」の2種類しか無く、
// 子が自分の子（＝孫）を持つことは許可しない。
export type Issue = {
  id: string;
  title: string;
  agentRunId?: string;
  charter: IssueCharter;
  actionItems: ActionItem[];
  parentId?: string;
  archived: boolean;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

function emptyCharter(): IssueCharter {
  return { why: "", what: "", how: "" };
}

// docs/memo.md TODO「Issueにカテゴリ・タグ付けをしたい」への対応。Journalのtagsと同じ
// 表記ゆれ吸収（trim・空文字除去・重複除去）をここでも行う。
function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
}

// 永続化ファイルに旧バージョン（charter/tagsフィールド追加前）のIssueが残っていても
// 壊れないよう、読み込み時に補完する。
const issues: Issue[] = loadJSON<Issue[]>("issues.json", []).map((issue) => ({
  ...issue,
  charter: issue.charter ?? emptyCharter(),
  archived: issue.archived ?? false,
  tags: issue.tags ?? [],
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

// docs 3.1「動的ロード」: そのAgent Runが紐づくIssueのWhy/What/Howを
// エージェントへの前提として注入するために使う（agent-runtime.ts）。
export function getIssueByRunId(agentRunId: string): Issue | undefined {
  return issues.find((i) => i.agentRunId === agentRunId);
}

export function listChildIssues(parentId: string): Issue[] {
  return issues.filter((i) => i.parentId === parentId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createIssue(
  title: string,
  agentRunId?: string,
  charter?: Partial<IssueCharter>,
  parentId?: string,
  tags?: string[],
): Issue {
  if (parentId) {
    const parent = getIssue(parentId);
    if (!parent) {
      throw new Error("親Issueが見つかりません");
    }
    if (parent.parentId) {
      throw new Error("この親Issue自体が子Issueのため、これ以上下に分解できません（親子関係は1階層まで）");
    }
  }

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
    parentId,
    archived: false,
    tags: normalizeTags(tags ?? []),
    createdAt: now,
    updatedAt: now,
  };
  issues.push(issue);
  persist();
  return issue;
}

// 既存のIssueの「上位」に新しいIssueを作り、既存のIssueをその子として付け替える
// （＝ズームアウト。大きな課題として括り直す）。既存のIssueが既に子（親を持つ）か、
// 既に自分の子を持っている場合は2階層を超えてしまうため拒否する。
export function createParentIssue(childId: string, title: string, charter?: Partial<IssueCharter>): Issue {
  const child = getIssue(childId);
  if (!child) {
    throw new Error("対象のIssueが見つかりません");
  }
  if (child.parentId) {
    throw new Error("このIssueは既に子Issueのため、さらに上位Issueを作ることはできません（親子関係は1階層まで）");
  }
  if (issues.some((i) => i.parentId === childId)) {
    throw new Error("このIssueには既に子Issueがあるため、上位Issueを作ると2階層を超えてしまいます");
  }

  const now = Date.now();
  const parent: Issue = {
    id: randomUUID(),
    title: title.trim(),
    charter: {
      why: charter?.why?.trim() ?? "",
      what: charter?.what?.trim() ?? "",
      how: charter?.how?.trim() ?? "",
    },
    actionItems: [],
    archived: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  issues.push(parent);
  child.parentId = parent.id;
  child.updatedAt = now;
  persist();
  return parent;
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

// docs/memo.md TODO「Issueのアーカイブなどができないのでできるようにする」への対応。
// 親子関係のカスケードは行わない（親をアーカイブしても子は独立してアーカイブ状態を持つ）。
// これは複雑さを避けるための意図的な簡略化で、一覧側は既定でトップレベルの
// 未アーカイブIssueのみを表示し、EMが明示的にトグルした場合のみアーカイブ済みも表示する。
export function setIssueArchived(issueId: string, archived: boolean): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  issue.archived = archived;
  issue.updatedAt = Date.now();
  persist();
  return issue;
}

export function setIssueTags(issueId: string, tags: string[]): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  issue.tags = normalizeTags(tags);
  issue.updatedAt = Date.now();
  persist();
  return issue;
}

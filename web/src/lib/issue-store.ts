import { randomUUID } from "node:crypto";
import { loadJSON, saveJSON } from "@/lib/persistence";
import { recordChangeEvent } from "@/lib/knowledge-store";
import { maskForStorage, maskNames, unmaskNames } from "@/lib/people-directory";

// 個人情報の分離（ユーザー指摘対応）: title・charter（why/what/how）はEMが自由記述する
// フィールドで人物名を含み得るため、保存前にmaskForStorage（ローカルNER検出＋PERSON_n
// 置換）を通す。tagsは構造的なラベル（例: "技術的負債"）であり個人名ではないため対象外。
// EM向けの表示（Dashboard等）は、これを返すAPIルート側でunmaskNamesを通してから応答する。

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

// ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
// Action Items（やる/やった）とは別に、進行中に思いついた時点でひとこと書き足すだけの
// 自由記述ログ。構造化フォーム（考えたこと欄／アクション欄／結果欄を分ける）にすると
// 記入の手間が増えて使われなくなるため、Quick Journal・EM自身のKeep/Problem/Tryと同じ
// 低摩擦な追記ログにする（種別を分けず、EMが自由に書く）。
export type IssueLogEntry = {
  id: string;
  text: string;
  createdAt: number;
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
  logEntries: IssueLogEntry[];
  parentId?: string;
  archived: boolean;
  // docs/memo.md「L. 介入の閉ループ」対応。直近でarchived: trueになった時刻
  // （unarchiveするとundefinedに戻す）。介入前後比較の起点として使う。
  archivedAt?: number;
  tags: string[];
  // docs/memo.md「H. 戦略→Issue→結果の一本線」対応。このIssueがどのKeyResultに
  // 貢献するかの紐付け（任意）。IDのみ保持し、実体（Objective/KeyResult）は
  // org-context-store.ts側にある。
  keyResultId?: string;
  // docs/memo.md「I. チーム単位の憲法」対応。このIssueがどのチームに関するものかの
  // 紐付け（任意）。
  teamId?: string;
  createdAt: number;
  updatedAt: number;
};

function emptyCharter(): IssueCharter {
  return { why: "", what: "", how: "" };
}

// docs/memo.md TODO「Issueにカテゴリ・タグ付けをしたい」への対応。Journalのtagsと同じ
// 表記ゆれ吸収（trim・空文字除去・重複除去）をここでも行う。
// 個人情報の分離（ユーザー指摘対応）: EMがタグに人物名を含めてしまうケース（例:
// 「#Aさん案件」）に備え、既知の登録済み名前をmaskNames（軽量・部分一致）で置換する。
function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((t) => maskNames(t.trim())).filter(Boolean)));
}

// 永続化ファイルに旧バージョン（charter/tagsフィールド追加前）のIssueが残っていても
// 壊れないよう、読み込み時に補完する。
const issues: Issue[] = loadJSON<Issue[]>("issues.json", []).map((issue) => ({
  ...issue,
  charter: issue.charter ?? emptyCharter(),
  archived: issue.archived ?? false,
  tags: issue.tags ?? [],
  logEntries: issue.logEntries ?? [],
}));

function persist(): void {
  saveJSON("issues.json", issues);
}

// 個人情報の分離（ユーザー指摘対応）: 上のCRUD関数・listIssues/getIssue等はマスクされた
// （PERSON_n ID化された）テキストを返す内部表現。EM向けのAPI応答を組み立てる境界だけで、
// この関数を通して実名へ復元する（agent-runtime.tsから呼んではいけない）。
export function toIssueView(issue: Issue): Issue {
  return {
    ...issue,
    title: unmaskNames(issue.title),
    charter: {
      why: unmaskNames(issue.charter.why),
      what: unmaskNames(issue.charter.what),
      how: unmaskNames(issue.charter.how),
    },
    actionItems: issue.actionItems.map((a) => ({ ...a, text: unmaskNames(a.text) })),
    logEntries: issue.logEntries.map((l) => ({ ...l, text: unmaskNames(l.text) })),
    tags: issue.tags.map(unmaskNames),
  };
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

export async function createIssue(
  title: string,
  agentRunId?: string,
  charter?: Partial<IssueCharter>,
  parentId?: string,
  tags?: string[],
  keyResultId?: string,
  teamId?: string,
): Promise<Issue> {
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
    title: await maskForStorage(title.trim()),
    agentRunId,
    charter: {
      why: charter?.why ? await maskForStorage(charter.why.trim()) : "",
      what: charter?.what ? await maskForStorage(charter.what.trim()) : "",
      how: charter?.how ? await maskForStorage(charter.how.trim()) : "",
    },
    actionItems: [],
    logEntries: [],
    parentId,
    archived: false,
    tags: normalizeTags(tags ?? []),
    keyResultId,
    teamId,
    createdAt: now,
    updatedAt: now,
  };
  issues.push(issue);
  persist();
  recordChangeEvent("issue", issue.id, `Issueを起票: 「${issue.title}」${parentId ? "（サブIssue）" : ""}`);
  return issue;
}

// 既存のIssueの「上位」に新しいIssueを作り、既存のIssueをその子として付け替える
// （＝ズームアウト。大きな課題として括り直す）。既存のIssueが既に子（親を持つ）か、
// 既に自分の子を持っている場合は2階層を超えてしまうため拒否する。
export async function createParentIssue(childId: string, title: string, charter?: Partial<IssueCharter>): Promise<Issue> {
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
    title: await maskForStorage(title.trim()),
    charter: {
      why: charter?.why ? await maskForStorage(charter.why.trim()) : "",
      what: charter?.what ? await maskForStorage(charter.what.trim()) : "",
      how: charter?.how ? await maskForStorage(charter.how.trim()) : "",
    },
    actionItems: [],
    logEntries: [],
    archived: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  issues.push(parent);
  child.parentId = parent.id;
  child.updatedAt = now;
  persist();
  recordChangeEvent("issue", parent.id, `Issueを起票: 「${parent.title}」（「${child.title}」の上位Issueとして）`);
  recordChangeEvent("issue", child.id, `上位Issue「${parent.title}」の下に再編されました`);
  return parent;
}

const CHARTER_FIELD_LABEL: Record<keyof IssueCharter, string> = { why: "Why", what: "What", how: "How" };

export async function updateIssueCharter(issueId: string, patch: Partial<IssueCharter>): Promise<Issue | undefined> {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const next: IssueCharter = {
    why: patch.why !== undefined ? await maskForStorage(patch.why.trim()) : issue.charter.why,
    what: patch.what !== undefined ? await maskForStorage(patch.what.trim()) : issue.charter.what,
    how: patch.how !== undefined ? await maskForStorage(patch.how.trim()) : issue.charter.how,
  };
  // 実際に値が変わったフィールドだけを変更履歴に残す（無変化の保存操作でノイズを増やさない）。
  const changedFields = (Object.keys(next) as (keyof IssueCharter)[]).filter((k) => next[k] !== issue.charter[k]);
  issue.charter = next;
  issue.updatedAt = Date.now();
  persist();
  if (changedFields.length > 0) {
    recordChangeEvent(
      "issue",
      issue.id,
      `${changedFields.map((k) => CHARTER_FIELD_LABEL[k]).join("・")}を更新しました`,
    );
  }
  return issue;
}

export async function addActionItem(issueId: string, text: string): Promise<Issue | undefined> {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return issue;
  const masked = await maskForStorage(trimmed);
  issue.actionItems.push({ id: randomUUID(), text: masked, done: false });
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `Action Itemを追加: 「${masked}」`);
  return issue;
}

// ユーザー依頼「EMがIssueに対して考えたこと・取ったアクション・結果を反映する」対応。
// addActionItemと同じ最小限の作りだが、done等の状態を持たない単純な追記のみ（種別を
// 分けない自由記述のため、後から編集・削除もしない——イベントソーシング的な記録として
// 積み上げるだけにする）。recordChangeEventも呼ぶため、Timelineにも自然に現れる。
export async function addLogEntry(issueId: string, text: string): Promise<Issue | undefined> {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return issue;
  const masked = await maskForStorage(trimmed);
  issue.logEntries.push({ id: randomUUID(), text: masked, createdAt: Date.now() });
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `経過ログを追加: 「${masked}」`);
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
  recordChangeEvent("issue", issue.id, `Action Item「${item.text}」を${item.done ? "完了" : "未完了"}にしました`);
  return issue;
}

// docs/memo.md TODO「Issueのアーカイブなどができないのでできるようにする」への対応。
// 親子関係のカスケードは行わない（親をアーカイブしても子は独立してアーカイブ状態を持つ）。
// これは複雑さを避けるための意図的な簡略化で、一覧側は既定でトップレベルの
// 未アーカイブIssueのみを表示し、EMが明示的にトグルした場合のみアーカイブ済みも表示する。
export function setIssueArchived(issueId: string, archived: boolean): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  if (issue.archived === archived) return issue;
  issue.archived = archived;
  // docs/memo.md「L. 介入の閉ループ」対応。updatedAtは他の編集でも動くため、
  // 「いつアーカイブされたか」を正確に知るための専用フィールドを持つ
  // （介入の前後比較の起点として使う）。
  issue.archivedAt = archived ? Date.now() : undefined;
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, archived ? "アーカイブしました" : "アーカイブを解除しました");
  return issue;
}

// docs/memo.md「H. 戦略→Issue→結果の一本線」対応。keyResultIdはIDそのもの（自由記述では
// ない）なのでmaskForStorageは不要——agentRunId/parentIdと同じ扱い。
export function setIssueKeyResult(issueId: string, keyResultId: string | null): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const next = keyResultId ?? undefined;
  if ((issue.keyResultId ?? null) === (next ?? null)) return issue;
  issue.keyResultId = next;
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, next ? "Key Resultに紐付けました" : "Key Resultの紐付けを解除しました");
  return issue;
}

// docs/memo.md「I. チーム単位の憲法」対応。teamIdはIDそのものなのでmaskForStorageは不要
// （agentRunId/parentId/keyResultIdと同じ扱い）。
export function setIssueTeam(issueId: string, teamId: string | null): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const next = teamId ?? undefined;
  if ((issue.teamId ?? null) === (next ?? null)) return issue;
  issue.teamId = next;
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, next ? "チームに紐付けました" : "チームの紐付けを解除しました");
  return issue;
}

export function setIssueTags(issueId: string, tags: string[]): Issue | undefined {
  const issue = getIssue(issueId);
  if (!issue) return undefined;
  const next = normalizeTags(tags);
  if (next.join(",") === issue.tags.join(",")) return issue;
  issue.tags = next;
  issue.updatedAt = Date.now();
  persist();
  recordChangeEvent("issue", issue.id, `タグを更新しました: ${next.join(", ") || "(なし)"}`, next);
  return issue;
}

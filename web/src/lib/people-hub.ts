import { addAlias, listPeople, mergePersons as mergePersonsInDirectory, removeAlias } from "@core/people-directory";
import {
  listActiveFactsForPerson,
  listInterpretationsForPerson,
  reassignPersonId,
  recordChangeEvent,
  toEventView,
  type KnowledgeEvent,
} from "@/lib/knowledge-store";
import { listActiveTeams, reassignPersonIdInTeams } from "@/lib/org-context-store";
import { listIssues, toIssueView, type Issue } from "@/lib/issue-store";
import { getRulesAndConstraints, getSelfPersonId, reassignSelfPersonId } from "@core/settings-store";
import { isIssueStalled, suggestionOverviewFromLogs } from "@core/types";
import { listPersonIssueConcernAcks, toPersonIssueConcernAckView } from "@/lib/person-concern-ack-store";

// docs/memo.md「J. Peopleを第一級ハブに」対応。新規の永続化エンティティは持たず、
// 既存のpeople-directory（誰がいるか）・knowledge-store（Journal fact／長期解釈）・
// org-context-store（チーム所属）・issue-store（関連Issue、org/page.tsxの関連Issue抽出と
// 同じ名前一致の簡易ヒューリスティック）を人物軸で束ねて見せるだけの集約レイヤー。

export type PersonTrend = { positive: number; negative: number; neutral: number };

export type PersonSummary = {
  id: string;
  name: string;
  // ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。
  aliases: string[];
  teamNames: string[];
  trend: PersonTrend;
  factCount: number;
  // ユーザー要望「部下(自分が管理するチームのメンバー)とそれ以外を分けたい」対応。
  // 自分が管理するチーム(Team.managedByEm)に1つでも所属していればtrue(兼務も部下扱い)。
  // ただし利用者本人(isSelf)は部下扱いしない。
  isDirectReport: boolean;
  // ユーザー要望「メンバーに自分自身を追加したいが区別できない」対応。
  // settings.selfPersonId と一致する人物。
  isSelf: boolean;
  // ユーザー指摘「バイタルがIssueの状況に対して問題無いように見える」対応。この人物名を
  // 含む未アーカイブIssueに、ブロッカーあり(status:"blocked")または停滞中(isIssueStalled)の
  // ものが1件でもあればtrue。personVitalStatusでJournalのsentimentが穏やかでも
  // 「やや注意」以上に引き上げるためのシグナル。
  hasConcerningIssue: boolean;
};

export type PersonFact = {
  id: string;
  text: string;
  tags: string[];
  sentiment?: KnowledgeEvent["sentiment"];
  urgency?: KnowledgeEvent["urgency"];
  occurredAt: number;
  // ユーザー指摘「確認したが対応不要だった、を示せずネガポジの強調を減らせない」対応。
  noActionNeededAt?: number;
  noActionNeededNote?: string;
};

export type PersonRelatedIssue = {
  id: string;
  title: string;
  archived: boolean;
  // docs/2nd_pivot_version.md Phase 2.3対応。IssueCharterをまるごと渡すと、UI側が
  // 「Why/What/Howの充足度」のような管理指標を組み立てやすくなってしまうため、
  // 要約テキスト1本（issueOverviewText）だけを渡す。
  overview: string;
  // ユーザー指摘「メンバーのアラート表示を確認したが対応不要だったことを示せない」対応。
  // このIssue単体が、hasConcerningIssueの根拠（停滞・ブロッカーあり、未アーカイブ）に
  // 該当するか。確認済み(concernAcknowledgedAt)であっても実際の状態はconcerning=trueの
  // まま返し、UI側は「確認済みだから強調を弱める」判断に使う（Issue自体の状態は隠さない）。
  concerning: boolean;
  concernAcknowledgedAt?: number;
  concernAcknowledgedNote?: string;
};

export type PersonProfile = PersonSummary & {
  facts: PersonFact[];
  interpretations: { id: string; text: string; occurredAt: number }[];
  relatedIssues: PersonRelatedIssue[];
};

const FACTS_LIMIT = 20;

// ユーザー指摘「確認済み（対応不要）の所見があってもバイタルのアラート色が落ちない」対応。
// hasConcerningRelatedIssue（Issue側）と同様、noActionNeededAt済みのfactはtrend（バイタルの
// 強調トリガー）の集計から除外する。fact自体はfacts一覧にconfirmed済みとして残り続ける。
function computeTrend(facts: KnowledgeEvent[]): PersonTrend {
  const trend: PersonTrend = { positive: 0, negative: 0, neutral: 0 };
  for (const f of facts) {
    if (f.noActionNeededAt) continue;
    if (f.sentiment === "positive") trend.positive += 1;
    else if (f.sentiment === "negative") trend.negative += 1;
    else trend.neutral += 1;
  }
  return trend;
}

function toPersonFact(e: KnowledgeEvent): PersonFact {
  return {
    id: e.id,
    text: e.text,
    tags: e.tags,
    sentiment: e.sentiment,
    urgency: e.urgency,
    occurredAt: e.occurredAt,
    noActionNeededAt: e.noActionNeededAt,
    noActionNeededNote: e.noActionNeededNote,
  };
}

// org/page.tsxの関連Issue抽出（selectedTeam.members.some(m => haystack.includes(m))）と
// 同じ考え方。issue-store側は既にtoIssueViewで実名復元済みなので、実名同士の単純な
// 部分一致で十分（厳密な紐付けではない簡易抽出）。
function findRelatedIssues(personName: string): Issue[] {
  return listIssues()
    .map(toIssueView)
    .filter((i) => {
      const memoText = i.logEntries.map((e) => e.text).join(" ");
      return `${i.title} ${memoText}`.includes(personName);
    });
}

// ユーザー指摘「バイタルがIssueの状況に対して問題無いように見える」対応。未アーカイブの
// 関連Issueに、ブロッカーあり・停滞中のものが1件でもあるかどうか。
// ユーザー指摘「確認したが対応不要だった、を示せずアラートの強調を減らせない」対応。
// EMが確認済み（対応不要）と判断したIssue（acknowledgedIssueIds）は、Issue自体は
// concerning=trueのまま関連Issue一覧に出しつつ、hasConcerningIssue（一覧・バイタルの
// 強調トリガー）の判定からは除外する。
function isConcerningIssue(i: Issue, now: number, staleDays: number): boolean {
  return !i.archived && (i.status === "blocked" || isIssueStalled(i, now, staleDays));
}

function hasConcerningRelatedIssue(
  relatedIssues: Issue[],
  now: number,
  staleDays: number,
  acknowledgedIssueIds: Set<string>,
): boolean {
  return relatedIssues.some((i) => isConcerningIssue(i, now, staleDays) && !acknowledgedIssueIds.has(i.id));
}

export function listPersonSummaries(): PersonSummary[] {
  const teams = listActiveTeams();
  const managedTeams = teams.filter((t) => t.managedByEm);
  const now = Date.now();
  const { staleInterventionDays } = getRulesAndConstraints();
  const selfPersonId = getSelfPersonId();
  return listPeople().map((p) => {
    const facts = listActiveFactsForPerson(p.id, FACTS_LIMIT);
    const isSelf = selfPersonId !== null && p.id === selfPersonId;
    const acknowledgedIssueIds = new Set(listPersonIssueConcernAcks(p.id).map((a) => a.issueId));
    return {
      id: p.id,
      name: p.name,
      aliases: p.aliases,
      teamNames: teams.filter((t) => t.members.includes(p.id)).map((t) => t.name),
      trend: computeTrend(facts),
      factCount: facts.length,
      isSelf,
      // 本人は「部下」に含めない（1on1 Coverage対象外と同じ考え方）。
      isDirectReport: !isSelf && managedTeams.some((t) => t.members.includes(p.id)),
      hasConcerningIssue: hasConcerningRelatedIssue(findRelatedIssues(p.name), now, staleInterventionDays, acknowledgedIssueIds),
    };
  });
}

// idOrNameはPERSON_n ID・正式名・別名のいずれでも受け付ける。チームメンバー一覧
// （org-context-store経由でEM向けには実名として返る）など、呼び出し元によっては
// IDを持っていないケースがあるための配慮。
export function getPersonProfile(idOrName: string): PersonProfile | undefined {
  const person = listPeople().find((p) => p.id === idOrName || p.name === idOrName || p.aliases.includes(idOrName));
  if (!person) return undefined;
  const id = person.id;

  const teams = listActiveTeams().filter((t) => t.members.includes(id));
  const facts = listActiveFactsForPerson(id, FACTS_LIMIT).map(toEventView);
  const interpretations = listInterpretationsForPerson(id)
    .map(toEventView)
    .map((e) => ({ id: e.id, text: e.text, occurredAt: e.occurredAt }));

  const relatedIssuesRaw = findRelatedIssues(person.name);
  const now = Date.now();
  const { staleInterventionDays } = getRulesAndConstraints();
  const acks = new Map(
    listPersonIssueConcernAcks(id).map((a) => [a.issueId, toPersonIssueConcernAckView(a)] as const),
  );
  const relatedIssues = relatedIssuesRaw.map((i) => {
    const ack = acks.get(i.id);
    return {
      id: i.id,
      title: i.title,
      archived: i.archived,
      overview: suggestionOverviewFromLogs(i.logEntries),
      concerning: isConcerningIssue(i, now, staleInterventionDays),
      concernAcknowledgedAt: ack?.createdAt,
      concernAcknowledgedNote: ack?.note,
    };
  });
  const selfPersonId = getSelfPersonId();
  const isSelf = selfPersonId !== null && person.id === selfPersonId;

  return {
    id: person.id,
    name: person.name,
    aliases: person.aliases,
    teamNames: teams.map((t) => t.name),
    trend: computeTrend(facts),
    factCount: facts.length,
    facts: facts.map(toPersonFact),
    interpretations,
    relatedIssues,
    isSelf,
    isDirectReport: !isSelf && teams.some((t) => t.managedByEm),
    hasConcerningIssue: hasConcerningRelatedIssue(
      relatedIssuesRaw,
      now,
      staleInterventionDays,
      new Set(acks.keys()),
    ),
  };
}

// ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。People詳細画面から
// 直接、既存の人物へ別名を追加・取り消しできるようにする薄いラッパー
// （people-directory.tsの対応表操作をそのまま呼ぶだけ）。
export function addPersonAlias(id: string, aliasName: string): { ok: true } | { ok: false; error: string } {
  return addAlias(id, aliasName);
}

export function removePersonAlias(id: string, aliasName: string): boolean {
  return removeAlias(id, aliasName);
}

// ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
// people-directory（対応表の付け替え）・knowledge-store（Journal等に埋め込まれた
// PERSON_n IDの書き換え）・org-context-store（チーム所属の付け替え）の3ストアを横断する
// 統合処理をここで束ねる（people-hub.tsが既に人物軸の集約レイヤーとして各ストアを
// import済みのため、ここが自然な置き場所）。fromId（統合元・消える側）をtoId（統合先・
// 残る側）へ統合する。
export function mergePersons(fromId: string, toId: string): { ok: true } | { ok: false; error: string } {
  const result = mergePersonsInDirectory(fromId, toId);
  if (!result.ok) return result;
  reassignPersonId(fromId, toId);
  reassignPersonIdInTeams(fromId, toId);
  reassignSelfPersonId({ fromId, toId });
  // 監査ログはPERSON_n IDのまま記録する（team更新時の「メンバー: ...」と同じ規約。
  // 実名はSQLiteへ書き込まない）。
  recordChangeEvent("person", toId, `重複していた人物（${fromId}）をこの人物へ統合しました。`);
  return { ok: true };
}

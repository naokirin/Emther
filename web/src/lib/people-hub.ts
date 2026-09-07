import { listPeople } from "@/lib/people-directory";
import { listActiveFactsForPerson, listInterpretationsForPerson, toEventView, type KnowledgeEvent } from "@/lib/knowledge-store";
import { listActiveTeams } from "@/lib/org-context-store";
import { listIssues, toIssueView, type IssueCharter } from "@/lib/issue-store";

// docs/memo.md「J. Peopleを第一級ハブに」対応。新規の永続化エンティティは持たず、
// 既存のpeople-directory（誰がいるか）・knowledge-store（Journal fact／長期解釈）・
// org-context-store（チーム所属）・issue-store（関連Issue、org/page.tsxの関連Issue抽出と
// 同じ名前一致の簡易ヒューリスティック）を人物軸で束ねて見せるだけの集約レイヤー。

export type PersonTrend = { positive: number; negative: number; neutral: number };

export type PersonSummary = {
  id: string;
  name: string;
  teamNames: string[];
  trend: PersonTrend;
  factCount: number;
};

export type PersonFact = {
  id: string;
  text: string;
  tags: string[];
  sentiment?: KnowledgeEvent["sentiment"];
  urgency?: KnowledgeEvent["urgency"];
  occurredAt: number;
};

export type PersonRelatedIssue = {
  id: string;
  title: string;
  archived: boolean;
  charter: IssueCharter;
};

export type PersonProfile = PersonSummary & {
  facts: PersonFact[];
  interpretations: { id: string; text: string; occurredAt: number }[];
  relatedIssues: PersonRelatedIssue[];
};

const FACTS_LIMIT = 20;

function computeTrend(facts: KnowledgeEvent[]): PersonTrend {
  const trend: PersonTrend = { positive: 0, negative: 0, neutral: 0 };
  for (const f of facts) {
    if (f.sentiment === "positive") trend.positive += 1;
    else if (f.sentiment === "negative") trend.negative += 1;
    else trend.neutral += 1;
  }
  return trend;
}

function toPersonFact(e: KnowledgeEvent): PersonFact {
  return { id: e.id, text: e.text, tags: e.tags, sentiment: e.sentiment, urgency: e.urgency, occurredAt: e.occurredAt };
}

export function listPersonSummaries(): PersonSummary[] {
  const teams = listActiveTeams();
  return listPeople().map((p) => {
    const facts = listActiveFactsForPerson(p.id, FACTS_LIMIT);
    return {
      id: p.id,
      name: p.name,
      teamNames: teams.filter((t) => t.members.includes(p.id)).map((t) => t.name),
      trend: computeTrend(facts),
      factCount: facts.length,
    };
  });
}

// idOrNameはPERSON_n IDまたは実名のどちらでも受け付ける。チームメンバー一覧
// （org-context-store経由でEM向けには実名として返る）など、呼び出し元によっては
// IDを持っていないケースがあるための配慮。
export function getPersonProfile(idOrName: string): PersonProfile | undefined {
  const person = listPeople().find((p) => p.id === idOrName || p.name === idOrName);
  if (!person) return undefined;
  const id = person.id;

  const teams = listActiveTeams().filter((t) => t.members.includes(id));
  const facts = listActiveFactsForPerson(id, FACTS_LIMIT).map(toEventView);
  const interpretations = listInterpretationsForPerson(id)
    .map(toEventView)
    .map((e) => ({ id: e.id, text: e.text, occurredAt: e.occurredAt }));

  // org/page.tsxの関連Issue抽出（selectedTeam.members.some(m => haystack.includes(m))）と
  // 同じ考え方。issue-store側は既にtoIssueViewで実名復元済みなので、実名同士の単純な
  // 部分一致で十分（厳密な紐付けではない簡易抽出）。
  const relatedIssues = listIssues()
    .map(toIssueView)
    .filter((i) => `${i.title} ${i.charter.why} ${i.charter.what} ${i.charter.how}`.includes(person.name))
    .map((i) => ({ id: i.id, title: i.title, archived: i.archived, charter: i.charter }));

  return {
    id: person.id,
    name: person.name,
    teamNames: teams.map((t) => t.name),
    trend: computeTrend(facts),
    factCount: facts.length,
    facts: facts.map(toPersonFact),
    interpretations,
    relatedIssues,
  };
}

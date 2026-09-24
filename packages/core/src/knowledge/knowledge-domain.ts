import { randomUUID } from "node:crypto";
import { cosineSimilarity } from "../embeddings";
import { isInvalidPersonNameEntry, unmaskNames } from "../people-directory";
import type { KnowledgeEventRepository } from "./knowledge-repository";
import type {
  EventPageFilter,
  KnowledgeEntityType,
  KnowledgeEvent,
  KnowledgeKind,
  NewKnowledgeEvent,
} from "./knowledge-types";

export type {
  EventPageFilter,
  KnowledgeContext,
  KnowledgeEntityType,
  KnowledgeEvent,
  KnowledgeKind,
  NewKnowledgeEvent,
} from "./knowledge-types";

/**
 * ナレッジイベントドメイン。永続化は KnowledgeEventRepository 経由のみ。
 */
export function createKnowledgeService(repo: KnowledgeEventRepository) {
  // sentiment等の観測値は
  // そのままに、EMの確認結果だけをin-placeで上書きする（新しいイベントは作らない＝
  // このイベント自身のsupersedesチェーンや一覧の並び順には影響しない）。
  function setEventNoActionNeeded(id: string, note: string | undefined): KnowledgeEvent | undefined {
    return repo.updateNoActionNeeded(id, { at: Date.now(), note: note ?? null });
  }

  function clearEventNoActionNeeded(id: string): KnowledgeEvent | undefined {
    return repo.updateNoActionNeeded(id, { at: null, note: null });
  }

  // noActionNeededと同様の
  // in-place更新。重複記録・誤入力等のJournalを一覧・AIの判断材料から除外する用途。
  function setEventArchived(id: string, reason?: "name_leak"): KnowledgeEvent | undefined {
    return repo.updateArchived(id, { at: Date.now(), reason: reason ?? null });
  }

  function clearEventArchived(id: string): KnowledgeEvent | undefined {
    return repo.updateArchived(id, { at: null, reason: null });
  }

  // Journal センシティブ設定。アーカイブと同様の in-place 更新。UI 一覧から既定で除外する。
  function setEventSensitive(id: string): KnowledgeEvent | undefined {
    return repo.updateSensitive(id, Date.now());
  }

  function clearEventSensitive(id: string): KnowledgeEvent | undefined {
    return repo.updateSensitive(id, null);
  }

  // people-directory.tsのdetectLeakedNamesが検知した登録名について、それを
  // 本文・要約・タグ・対応メモに部分文字列として含む未アーカイブのイベントを特定し、
  // 即座にアーカイブする（searchSimilarEventsは既定でアーカイブ済みを除外するため、
  // 以降の他の分析への連鎖混入がその場で止まる）。実名そのものはここでもログに出さず、
  // 隔離できたイベントIDだけを返す（呼び出し側がrun.logへ記録する）。
  // 単一ローカルユーザー規模の想定（他のTTL/superseded走査と同じ前提）なので、
  // 稀にしか通らないこの経路でも全件走査で十分。
  function quarantineEventsContainingNames(names: string[]): string[] {
    const safeNames = names.filter((n) => n.trim().length >= 2 && !isInvalidPersonNameEntry(n));
    if (safeNames.length === 0) return [];
    const quarantinedIds: string[] = [];
    for (const row of repo.listUnarchivedTextRows()) {
      const haystack = `${row.text}\n${row.summary ?? ""}\n${JSON.stringify(row.tags)}\n${row.resolutionNote ?? ""}`;
      if (safeNames.some((name) => haystack.includes(name))) {
        setEventArchived(row.id, "name_leak");
        quarantinedIds.push(row.id);
      }
    }
    return quarantinedIds;
  }

  function recordEvent(input: NewKnowledgeEvent): KnowledgeEvent {
    const event: KnowledgeEvent = {
      ...input,
      teamIds: input.teamIds ?? [],
      id: input.id ?? randomUUID(),
      recordedAt: input.recordedAt ?? Date.now(),
    };
    repo.insert(event);
    return event;
  }

  // イベントソーシング（イベントは削除・
  // 上書きしない）を保ったまま「その場微修正」を実現するため、既存イベントを1件取得し、
  // supersedesで新イベントに繋ぐための参照用途。
  function getEventById(id: string): KnowledgeEvent | undefined {
    return repo.findById(id);
  }

  // supersedes チェーンの先頭（いま一覧に出る版）を返す。生成元リンクが古い版の ID を
  // 指していても、EM が開く先は現行エントリである必要がある。
  function getEventHeadById(id: string): KnowledgeEvent | undefined {
    let current = getEventById(id);
    if (!current) return undefined;
    while (true) {
      const next = repo.findNewestSuperseding(current.id);
      if (!next) return current;
      current = next;
    }
  }

  function listEventLineageIds(id: string): string[] {
    const start = getEventById(id);
    if (!start) return [];
    let root = start;
    const seen = new Set<string>([root.id]);
    while (root.supersedes) {
      const prev = getEventById(root.supersedes);
      if (!prev || seen.has(prev.id)) break;
      seen.add(prev.id);
      root = prev;
    }
    const ids = [root.id];
    let current = root;
    while (true) {
      const next = repo.findNewestSuperseding(current.id);
      if (!next) return ids;
      if (ids.includes(next.id)) return ids;
      ids.push(next.id);
      current = next;
    }
  }

  function listEvents(filter?: { entityType?: KnowledgeEntityType; kind?: KnowledgeKind }): KnowledgeEvent[] {
    return repo.list(filter);
  }

  // listEventsは常に全件を
  // 返すため、件数が増えるほどAPIレスポンス・パース・マスク処理のコストが線形に増加する。
  // こちらはWHERE句・LIMIT/OFFSETをSQL側で組み立て、該当ページ分の行と総件数だけを返す。
  function listEventsPage(
    filter: EventPageFilter,
    opts: { limit: number; offset: number },
  ): { events: KnowledgeEvent[]; total: number } {
    return {
      events: repo.listPage(filter, opts),
      total: repo.countMatching(filter),
    };
  }

  // 対象イベントが、同じfilter・並び順（occurred_at DESC, recorded_at DESC）の
  // 何件目（0-indexed）に位置するかを1クエリで求める。クライアント側で全件を走査してインデックスを
  // 探す必要をなくす。
  function findEventOffset(
    target: { occurredAt: number; recordedAt: number },
    filter: EventPageFilter,
  ): number {
    return repo.countBefore(target, filter);
  }

  // 絞り込みドロップダウン
  // （タグ・人物）の選択肢一覧。listEvents（SELECT *）と違い、tags_json/people_jsonの
  // 2カラムだけを読むため、件数が増えても本文・要約等の重いフィールドを読み込まずに済む。
  function listEventFacets(filter: {
    entityType?: KnowledgeEntityType;
    kind?: KnowledgeKind;
    excludeSuperseded?: boolean;
    excludeArchived?: boolean;
    excludeSensitive?: boolean;
  }): { tags: string[]; people: string[] } {
    const tags = new Set<string>();
    const people = new Set<string>();
    for (const row of repo.listFacetRows(filter)) {
      for (const t of row.tags) tags.add(t);
      for (const p of row.people) people.add(p);
    }
    return { tags: Array.from(tags), people: Array.from(people) };
  }

  // TTL切れかどうかの判定。ttlDaysが無い場合は常にfalse（＝常に有効＝長期解釈・公式方針）。
  function isEventExpired(event: KnowledgeEvent, now = Date.now()): boolean {
    if (event.ttlDays === undefined) return false;
    return event.occurredAt + event.ttlDays * 24 * 60 * 60 * 1000 < now;
  }

  // 特定の人物に関する「今も重みを持つファクト」。TTL切れのものと、supersedesで
  // 置き換えられた旧版・アーカイブ済みは除外する（Journal一覧のlistJournalEntriesと
  // 同じ方針。削除はしない＝listEventsで全履歴は引き続き参照可能）。アーカイブ除外は
  // 実名リーク検知時の自動隔離（quarantineEventsContainingNames）が
  // このAgent動的ロード経路（名前の直接一致によるbuildJournalContextBlock）を通しても
  // 確実に効くようにするため（similarEvent検索経由の混入だけを塞いでも、こちらの経路が
  // 抜けていると連鎖が止まらない）。
  // personIdはpeople-directory.tsの`PERSON_n` ID（実名ではない）。
  // excludeIdは、いま分析中の
  // Journal自身のイベントIDを渡すことで、自分自身を「過去のファクト」として参照情報に
  // 混入させない（分析対象は既に保存・登録済みのため、素朴に検索すると自分自身がヒットする）。
  function listActiveFactsForPerson(personId: string, limit = 5, excludeId?: string): KnowledgeEvent[] {
    const events = listEvents({ kind: "fact" });
    const supersededIds = new Set(events.map((e) => e.supersedes).filter((id): id is string => !!id));
    return events
      .filter(
        (e) =>
          e.people.includes(personId) &&
          !isEventExpired(e) &&
          !supersededIds.has(e.id) &&
          !e.archivedAt &&
          e.id !== excludeId,
      )
      .slice(0, limit);
  }

  // 特定の人物に関する長期的な解釈（プロファイル）。TTLの概念上、基本的に常に有効。
  // アーカイブ済みは除外する（listActiveFactsForPersonと同じ理由）。
  function listInterpretationsForPerson(personId: string): KnowledgeEvent[] {
    return listEvents({ kind: "interpretation" }).filter((e) => e.people.includes(personId) && !e.archivedAt);
  }

  // 個人情報の分離: 上記の関数群はマスクされた（PERSON_n ID化された）
  // テキストを返す内部表現。EM向けのAPI応答を組み立てる境界だけで、この関数を通して
  // 実名へ復元する（agent-runtime.tsから呼んではいけない）。
  function toEventView(event: KnowledgeEvent): KnowledgeEvent {
    return {
      ...event,
      text: unmaskNames(event.text),
      summary: event.summary !== undefined ? unmaskNames(event.summary) : event.summary,
      people: event.people.map(unmaskNames),
      noActionNeededNote:
        event.noActionNeededNote !== undefined ? unmaskNames(event.noActionNeededNote) : event.noActionNeededNote,
    };
  }

  // Suggestion/Teamの変更履歴を1つのentityId単位で取得する。
  function listEventsForEntity(entityType: KnowledgeEntityType, entityId: string): KnowledgeEvent[] {
    return listEvents({}).filter((e) => e.entityId === entityId && e.entityType === entityType);
  }

  // 特定のentityに絞らず、
  // Suggestion/Team/Goalの変更（recordChangeEventで記録されるkind:"fact" context:"official"）
  // を横断的に新しい順で返す。Journal（context:"observation"）は含めない
  // （「組織の状態がどう変わったか」の物語であり、日々の所感・出来事のログとは別軸）。
  function listRecentChangeEvents(limit = 100): KnowledgeEvent[] {
    return listEvents({ kind: "fact" })
      .filter((e) => e.context === "official")
      .slice(0, limit);
  }

  // Suggestion/Team/人物の変更履歴記録用の薄いヘルパー。変更は
  // 「起きた出来事そのもの」なのでkind:"fact"、組織の管理された状態変化なのでcontext:"official"
  // で固定する。変更履歴は削除・上書きされるべきでない永続的な監査証跡のためttlDaysは付けない。
  function recordChangeEvent(
    entityType: "suggestion" | "team" | "org" | "person",
    entityId: string,
    text: string,
    tags: string[] = [],
  ): void {
    recordEvent({
      kind: "fact",
      context: "official",
      entityType,
      entityId,
      people: [],
      teamIds: [],
      text,
      tags,
      occurredAt: Date.now(),
    });
  }

  // people-directory.ts（対応表）の付け替えだけでは不十分で、既にSQLiteへ保存済みの
  // KnowledgeEvent（Journalのtext/summary/tags/people、Issueへの解決メモ等）に埋め込まれた
  // fromId（PERSON_n）をtoIdへ書き換える必要がある。text/summary/resolution_noteは
  // 自由記述への埋め込み置換（同じ文中に元々fromId/toId両方への言及があった場合、
  // 書き換え後は同じ人物への言及が重複するだけで、内容としては正しい）。
  // tags_json/people_jsonはID配列なので、置換後にtoIdが重複しうる（元々fromId/toId両方が
  // 含まれていた場合）ため、配列としてパースし直して重複排除する。
  function replaceIdInJsonArray(json: string, pattern: RegExp, toId: string): string {
    const replaced = json.replace(pattern, toId);
    try {
      const arr = JSON.parse(replaced) as string[];
      return JSON.stringify(Array.from(new Set(arr)));
    } catch {
      return replaced;
    }
  }

  function reassignPersonId(fromId: string, toId: string): number {
    const pattern = new RegExp(`\\b${fromId}\\b`, "g");
    let updated = 0;
    for (const row of repo.listPersonFieldRows()) {
      const nextText = row.text.replace(pattern, toId);
      const nextSummary =
        row.summary !== undefined ? row.summary.replace(pattern, toId) : row.summary;
      const nextTags = replaceIdInJsonArray(row.tagsJson, pattern, toId);
      const nextPeople = replaceIdInJsonArray(row.peopleJson, pattern, toId);
      const nextNote =
        row.resolutionNote !== undefined ? row.resolutionNote.replace(pattern, toId) : row.resolutionNote;
      if (
        nextText !== row.text ||
        nextSummary !== row.summary ||
        nextTags !== row.tagsJson ||
        nextPeople !== row.peopleJson ||
        nextNote !== row.resolutionNote
      ) {
        repo.updatePersonFields(row.id, {
          text: nextText,
          summary: nextSummary ?? null,
          tagsJson: nextTags,
          peopleJson: nextPeople,
          resolutionNote: nextNote ?? null,
        });
        updated++;
      }
    }
    return updated;
  }

  function isSearchCandidateExpired(
    row: { occurredAt: number; ttlDays?: number },
    now = Date.now(),
  ): boolean {
    if (row.ttlDays === undefined) return false;
    return row.occurredAt + row.ttlDays * 24 * 60 * 60 * 1000 < now;
  }

  // 埋め込みを持つイベントに限定して
  // ブルートフォースでコサイン類似度を計算し、上位を返す。単一ローカルユーザー規模
  // （数百万件に達するには何年もかかる想定）ではこれで十分高速なため、専用のベクトル
  // インデックス（sqlite-vec等）は導入しない。TTL切れのfactは除外する（意味的に近くても、
  // 現在の判断への重みを失った一時的な情報を混ぜないため）。
  // アーカイブ済み・supersedesで置き換え済みの旧版も既定で除外する（
  // 実名リークしたJournalを修正してリセット→再分析しても、旧版が類似検索経由でAgentの
  // プロンプトに混入し実名が再発するバグがあったため）。呼び出し側は明示的にfalseを
  // 渡さない限りこの既定を変えられない。
  // スコアリングは embedding 列だけを読み、上位候補の本文等は結果確定後にまとめて取得する。
  function searchSimilarEvents(
    queryEmbedding: number[],
    opts?: {
      kind?: KnowledgeKind;
      limit?: number;
      excludeExpired?: boolean;
      excludeArchived?: boolean;
      excludeSuperseded?: boolean;
      // 分析対象イベント自身は
      // 既に保存・埋め込み計算済みのため、素朴に検索すると類似度1.0近くで自分自身が
      // ヒットしてしまう。呼び出し元がいま分析中のイベントIDを渡して除外する。
      excludeId?: string;
    },
  ): Array<KnowledgeEvent & { similarity: number }> {
    const limit = opts?.limit ?? 5;
    const excludeExpired = opts?.excludeExpired ?? true;
    const scored: Array<{ id: string; similarity: number }> = [];
    for (const row of repo.listSearchCandidates({
      kind: opts?.kind,
      excludeArchived: opts?.excludeArchived,
      excludeSuperseded: opts?.excludeSuperseded,
    })) {
      if (row.id === opts?.excludeId) continue;
      if (excludeExpired && isSearchCandidateExpired(row)) continue;
      scored.push({ id: row.id, similarity: cosineSimilarity(queryEmbedding, row.embedding) });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    const top = scored.slice(0, limit);
    const similarityById = new Map(top.map((item) => [item.id, item.similarity]));
    return repo.findByIds(top.map((item) => item.id)).map((event) => ({
      ...event,
      similarity: similarityById.get(event.id)!,
    }));
  }

  return {
    setEventNoActionNeeded,
    clearEventNoActionNeeded,
    setEventArchived,
    clearEventArchived,
    setEventSensitive,
    clearEventSensitive,
    quarantineEventsContainingNames,
    recordEvent,
    getEventById,
    getEventHeadById,
    listEventLineageIds,
    listEvents,
    listEventsPage,
    findEventOffset,
    listEventFacets,
    isEventExpired,
    listActiveFactsForPerson,
    listInterpretationsForPerson,
    toEventView,
    listEventsForEntity,
    listRecentChangeEvents,
    recordChangeEvent,
    reassignPersonId,
    searchSimilarEvents,
  };
}

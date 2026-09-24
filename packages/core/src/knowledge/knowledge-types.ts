// docs/memo.md「H: 永続化データモデルの設計」の中核。ユーザー方針:
// 「組織・人・システムは時系列で一貫せず、方針転換・一時的感情・環境変化を多く受ける前提で
//  ナレッジをデータ化する必要がある」への対応。「上書きされるデータベース」ではなく、
// 状態の変化を履歴として蓄積するイベントソーシング＋バイテンポラル（実世界でいつ真だったか
// occurredAt／システムがいつ記録したか recordedAt）のモデルを採用する。
//
// ファクトと解釈の分離:
//   kind: "fact"           = 起きた出来事そのもの（例: 「Aさんが『辞めたい』と言った」）
//   kind: "interpretation" = そこから導いた長期的な解釈（例: 「Aさんはリーダー志向がある」）
// context（公式方針か、雑談か、一時的な不満か）とttlDays（現在の判断にどれだけの期間
// 重みを持たせるか）をすべてのイベントに付与する。ttlDaysが無い＝長期有効（解釈・公式方針等）。
// 重要: イベントは削除しない。ttlDaysは「重み」の話であり「履歴からの消去」の話ではない。

export type KnowledgeKind = "fact" | "interpretation";
export type KnowledgeContext = "official" | "observation" | "casual" | "complaint" | "profile";
export type KnowledgeEntityType = "journal" | "person" | "team" | "suggestion" | "org";

export type KnowledgeEvent = {
  id: string;
  kind: KnowledgeKind;
  context: KnowledgeContext;
  entityType: KnowledgeEntityType;
  // Suggestion/Teamの変更履歴（Phase 2）のように、特定の1エンティティ（suggestionId/teamId）を
  // 一意に指す必要がある場合に使う。人物についてのイベント（peopleで名前を持つ）とは
  // 直交する概念なので、両方が同時に埋まることもある（例: 「提案にAさんの名前が言及された」）。
  entityId?: string;
  // 個人情報の分離（ユーザー指摘対応）: 実名ではなくpeople-directory.tsが発行する
  // `PERSON_n` IDを保持する（recordEvent呼び出し側が保存前に変換する）。text/summaryも
  // 同様にPERSON_n IDでマスクした状態で保存する。実名への復元はtoEventView()を通す。
  people: string[];
  // Journal→チームの明示紐付け（Team.id の配列。チーム名は個人名ではないためマスク不要）。
  teamIds: string[];
  text: string;
  tags: string[];
  urgency?: "low" | "mid" | "high";
  sentiment?: "positive" | "negative" | "neutral";
  summary?: string;
  occurredAt: number;
  recordedAt: number;
  ttlDays?: number;
  supersedes?: string;
  sourceJournalId?: string;
  // docs/memo.md「H: Phase 3」ローカル完結のベクトル検索用。@/lib/embeddingsで生成した
  // 埋め込みベクトル。Issue/Teamの変更履歴等、意味的検索の対象外のイベントには付与しない。
  embedding?: number[];
  // docs/em_human_story_and_ux.md 改修依頼対応。urgencyは「起きた出来事自体の深刻さ」の
  // 記録として書き換えない一方、「今どこで管理されているか」を別軸として持たせる
  // （Journal専用の概念だが、他のentityTypeで使っても害はないため型を分けない）。
  resolvedSuggestionId?: string;
  resolutionNote?: string;
  // docs/observation_dump_journal.md: 外部ログ取り込み Dump／チャンクへの弱いリンク。
  sourceDumpId?: string;
  sourceChunkId?: string;
  // ユーザー指摘「確認したが対応不要だった、をEM側から示せない・UI上の強調を減らせない」
  // 対応。sentiment等の観測値自体は書き換えず、EMが確認して対応不要と判断した事実だけを
  // 別途持たせる（in-place更新。内容の訂正ではないためsupersedesチェーンは使わない）。
  noActionNeededAt?: number;
  noActionNeededNote?: string;
  // docs/memo.md「相談、Journal、提案を削除（アーカイブ）したい」対応。noActionNeededAtと
  // 同様のin-place更新（内容の訂正ではないためsupersedesチェーンは使わない）。立っている
  // イベントは一覧・AIの判断材料から除外する（イベント自体は削除しない）。
  archivedAt?: number;
  // docs/memo.md「実名を含んでしまっていた場合に自動で隔離されたJournalをユーザーが
  // 確認できるようにしたい」対応。手動アーカイブ（archivedAtのみ）と区別するため、
  // 自動隔離（quarantineEventsContainingNames）のときだけ"name_leak"を設定する。
  archivedReason?: "name_leak";
  // Journal センシティブ設定。UI 一覧から既定で除外する（アーカイブと同様 in-place。
  // エージェント／分析の入力からは除外しない）。
  sensitiveAt?: number;
};

export type NewKnowledgeEvent = Omit<KnowledgeEvent, "id" | "recordedAt" | "teamIds"> & {
  id?: string;
  recordedAt?: number;
  teamIds?: string[];
};

export type EventPageFilter = {
  entityType?: KnowledgeEntityType;
  kind?: KnowledgeKind;
  // 自由記述検索（text/summary/tags_json/people_jsonへの部分一致）。text/people_jsonは
  // PERSON_n（または {{PERSON_n}}）でマスクされた状態で保存されているため、呼び出し側
  // （journal-store.ts）が検索語を渡す前にmaskNames / maskNamesSearchFormsで変換しておくこと。
  // 文字列1つ、または区切り付き・裸IDの両形（既存データ互換）。
  textQuery?: string | string[];
  // タグ・人物の完全一致フィルタ（JSON配列内の要素として存在するか）。personExactは
  // PERSON_n ID、tagExactはマスク後のタグ文字列を渡すこと（textQueryと同じ理由）。
  tagExact?: string | string[];
  personExact?: string;
  urgency?: string;
  sentiment?: string;
  occurredAtFrom?: number;
  excludeResolved?: boolean;
  excludeSuperseded?: boolean;
  excludeArchived?: boolean;
  // docs/memo.md「実名を含んでしまっていた場合に自動で隔離されたJournalをユーザーが
  // 確認できるようにしたい」対応。excludeArchivedとは独立（隔離済みだけに絞り込みたい
  // ときはexcludeArchivedをfalseにした上でこれを指定する）。
  archivedReasonExact?: string;
  // Journal センシティブ設定。UI 一覧から既定で除外する。
  excludeSensitive?: boolean;
};

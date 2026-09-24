export type GrowReference = {
  // 参考になりそうな学びのトピック・理論名・フレームワーク名・著者名等。
  topic: string;
  // true: 理論の提唱者による原著・原典（一次資料）。英語であっても構わない。
  // false: 実務書・解説記事等の二次資料。日本語のものを優先する。
  isPrimarySource: boolean;
  note?: string;
  // LLMが実在すると
  // 確信できるURL（Wikipedia・公式サイト・出版社ページ等）のみを想定した任意項目。
  // 不確かな場合はLLM側でurlを省略する運用とし、UI側はurl不在時にtopicの検索リンクへ
  // フォールバックする（存在しない/誤ったURLを断定的に提示しないための二段構え）。
  url?: string;
};

export type GrowSuggestionDraft = {
  title: string;
  rationale: string;
  evidenceSummary?: string;
  references: GrowReference[];
};

export type GrowSuggestionStatus = "unread" | "acknowledged" | "dismissed";

export const GROW_SUGGESTION_STATUSES: GrowSuggestionStatus[] = ["unread", "acknowledged", "dismissed"];

export type GrowSuggestion = GrowSuggestionDraft & {
  id: string;
  weekKey: string;
  status: GrowSuggestionStatus;
  sourceRunId?: string;
  generatedAt: number;
};

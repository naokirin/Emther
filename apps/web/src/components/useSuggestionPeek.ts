import { useContext } from "react";
import { IdResolveContext } from "./idResolveContext";

// docs/memo.md「各画面で提案のリンクを踏んだときのデフォルト挙動をサイドピークにする」対応。
// SuggestionPeekRoot（app/layout.tsx）がIdResolveProviderをアプリ全体へ被せるため、
// どの画面のコンポーネントからでもこのhookで同じ提案サイドピークを開ける
// （そのページが独自のIdResolveProviderを持っていればそちらが優先される——timeline/page.tsx等）。
export function useSuggestionPeek(): { id: string | null; open: (id: string) => void; close: () => void } {
  const { openSuggestionInPeek, suggestionPeekId, closeSuggestionPeek } = useContext(IdResolveContext);
  return {
    id: suggestionPeekId ?? null,
    open: openSuggestionInPeek ?? (() => {}),
    close: closeSuggestionPeek ?? (() => {}),
  };
}

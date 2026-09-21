import { createContext } from "react";

export type IdResolveContextValue = {
  /** サイドピーク内なら提案をピークで開き直す。未指定時は通常のページ遷移。 */
  openSuggestionInPeek?: (id: string) => void;
  /** 提案の全画面共通サイドピークの現在の対象id（useSuggestionPeek向け）。 */
  suggestionPeekId?: string | null;
  closeSuggestionPeek?: () => void;
};

export const IdResolveContext = createContext<IdResolveContextValue>({});

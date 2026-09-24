import type { ReactNode } from "react";
import { SlideOver } from "./SlideOver";
import { IdResolveProvider } from "./IdFragmentLink";
import { SuggestionDetailContent } from "./SuggestionDetailContent";
import { usePeekParam } from "../lib/usePeekParam";

// useTypedSearchParams上の共通フック（../lib/usePeekParam）を使う。
// react-routerのuseSearchParamsはSuspenseを要求しないため、Suspenseラッパーは不要。

export function SuggestionPeekRoot({ children }: { children: ReactNode }) {
  const peek = usePeekParam("suggestion");
  return (
    <IdResolveProvider openSuggestionInPeek={peek.open} suggestionPeekId={peek.id} closeSuggestionPeek={peek.close}>
      {children}
      {peek.id && (
        <SlideOver title="提案の詳細" detailHref={`/suggestions/${peek.id}`} onClose={peek.close}>
          <SuggestionDetailContent id={peek.id} />
        </SlideOver>
      )}
    </IdResolveProvider>
  );
}

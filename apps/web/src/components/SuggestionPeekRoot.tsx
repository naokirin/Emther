import type { ReactNode } from "react";
import { SlideOver } from "./SlideOver";
import { IdResolveProvider } from "./IdFragmentLink";
import { SuggestionDetailContent } from "./SuggestionDetailContent";
import { usePeekParam } from "../lib/usePeekParam";

// web/src/components/SuggestionPeekRoot.tsx（Next.js版）からの移植（フェーズ3.5、ルートシェル）。
// 元実装のusePeekParam（@/lib/hooks、next/navigationのuseSearchParams依存でSuspense必須）を
// フェーズ3.3で確立したuseTypedSearchParams上の共通フック（../lib/usePeekParam、tier2
// timelineバッチで抽出）に置き換えた。react-routerのuseSearchParamsはSuspenseを要求しない
// ため、元実装のSuspenseラッパーは不要（削除した）。

export function SuggestionPeekRoot({ children }: { children: ReactNode }) {
  const peek = usePeekParam("suggestion");
  return (
    <IdResolveProvider openIssueInPeek={peek.open} suggestionPeekId={peek.id} closeSuggestionPeek={peek.close}>
      {children}
      {peek.id && (
        <SlideOver title="提案の詳細" detailHref={`/suggestions/${peek.id}`} onClose={peek.close}>
          <SuggestionDetailContent id={peek.id} />
        </SlideOver>
      )}
    </IdResolveProvider>
  );
}

"use client";

import { Suspense, type ReactNode } from "react";
import { usePeekParam } from "@/lib/hooks";
import { SlideOver } from "@/components/SlideOver";
import { SuggestionDetailContent } from "@/components/SuggestionDetailContent";
import { IdResolveProvider } from "@/components/IdFragmentLink";

// docs/memo.md「各画面で提案のリンクを踏んだときのデフォルト挙動をサイドピークにする」対応。
// これまでは/suggestions・/timelineなど一部の一覧画面だけがIdResolveProviderを自前で
// 持ち、その画面の中でだけ提案リンクがサイドピークになっていた（他画面では素の
// ページ遷移がデフォルト）。app/layout.tsxでこれを全画面に被せることで、どの画面から
// 提案リンクを踏んでもサイドピークが既定の挙動になる（自前のIdResolveProviderを持つ
// 画面ではそちらが優先される＝ネストしたContext.Providerが内側を上書きする）。
function SuggestionPeekRootInner({ children }: { children: ReactNode }) {
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

// usePeekParamはuseSearchParamsを使うため<Suspense>で包む必要がある（Next.js公式の要件）。
// fallbackはchildren自体にする（全画面に被せるため、解決までのあいだ空白にはしない——
// ピーク機能が使えるようになるまでの一瞬だけ、通常のページ遷移にフォールバックする）。
export function SuggestionPeekRoot({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <SuggestionPeekRootInner>{children}</SuggestionPeekRootInner>
    </Suspense>
  );
}

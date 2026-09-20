import { Navigate } from "react-router";

// web/src/app/issues/page.tsx（Next.js版、next/navigationのredirect()を使ったサーバー
// リダイレクト）からの移植（フェーズ3.5 tier1）。docs/2nd_pivot_version.md Phase 7で
// 課題タブは提案に統合済み。クライアントサイドの<Navigate replace>で同じ挙動にする。
export function IssuesRedirect() {
  return <Navigate to="/suggestions" replace />;
}

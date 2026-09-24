import { Navigate } from "@/router";

// 課題タブは提案に統合済み。/suggestions へ replace リダイレクトする。
export function IssuesRedirect() {
  return <Navigate to="/suggestions" replace />;
}

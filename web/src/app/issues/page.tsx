import { redirect } from "next/navigation";

// docs/2nd_pivot_version.md Phase 7。課題タブは提案に統合。
export default function IssuesRedirectPage() {
  redirect("/suggestions");
}

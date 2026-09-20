import type { YieldKind } from "@emther/core/types";

// RunDetail.tsx本体とrun-detail/配下の各表示コンポーネントの両方から使う純粋関数。
// RunDetail.tsxがこのファイルをimportし、そのまま同じ名前でre-exportすることで、
// 呼び出し側（@/components/RunDetailを使う各画面）の公開APIは変えていない。
// ここに置くことで、run-detail/配下のコンポーネントがRunDetail.tsx（値としての
// import）に依存する循環参照を避けられる（型のみはimport typeで参照してよい）。

// docs/em_ui_ux_issue.md 5節「Yield種別カードUI」対応。サーバー側（agent-runtime.ts）は
// 既にkindを正規化して返すが、キャッシュされた古いrunデータ等との保険として同じ
// フォールバック（options有無からdecide/informへ）をクライアント側にも持たせる。
export function resolveYieldKind(kind: YieldKind | undefined, optionsLength: number): YieldKind {
  if (kind) return kind;
  return optionsLength === 0 ? "inform" : "decide";
}

/** proposal から起票タイトル候補を返す（issueCandidates優先、なければ issueTitle）。 */
export function listIssueCandidatesFromProposal(
  proposal?: { issueCandidates?: { title: string; rationale?: string }[]; issueTitle?: string } | null,
): { title: string; rationale?: string }[] {
  if (!proposal) return [];
  const fromArray = (proposal.issueCandidates ?? [])
    .map((c) => ({
      title: c.title.trim(),
      ...(c.rationale?.trim() ? { rationale: c.rationale.trim() } : {}),
    }))
    .filter((c) => c.title.length > 0);
  if (fromArray.length > 0) return fromArray;
  const single = proposal.issueTitle?.trim();
  return single ? [{ title: single }] : [];
}

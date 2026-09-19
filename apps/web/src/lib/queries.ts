// フェーズ3.2: web/src/lib/hooks.ts の usePolling 群を TanStack Query で置き換える方針の実装。
//
// 決定事項（docs/2nd_architecture/plan.md フェーズ3.2参照）:
// - ポーリングは 1:1 で `refetchInterval` に対応させる（間隔ms・enabledの意味はusePollingと同じ）。
// - 旧 usePolling が返していた `setXxx`（ミューテーション直後にローカルstateへ即時反映する
//   楽観的更新）は、呼び出し側が `useQueryClient().setQueryData(queryKey, ...)` を直接呼ぶ形に置き換える。
//   TanStack Queryのqueryキャッシュ自体がこのユースケースの標準機構であり、旧実装のように
//   フック側に個別のsetter（setIssues/setRuns等）を用意する理由が無くなるため。
// - 旧 `loaded`（初回フェッチ完了フラグ）は `!isPending` に対応する。`data` の初期値（旧fallback）は
//   TanStack Queryでは`undefined`が自然なため、呼び出し側で `data?.xxx ?? []` のように扱う
//   （画面移植時にfallback値をコールサイト側に明示的に残す）。
// - 失敗時の扱い: 旧 usePolling は「静かに無視し次回ポーリングに任せる」だったが、TanStack Query の
//   既定（失敗時は自動リトライ）はこれに近い挙動になる。明示的なエラーUIが必要な画面のみ
//   `query.isError` を個別に見る（3.5の画面移植で必要に応じて対応）。
// - queryKeyの命名は `["api", ...urlのpathセグメント, ...パラメータ]` に統一し、
//   ミューテーション成功後の `invalidateQueries` がURL単位で機械的に書けるようにする。
//
// 本ファイルには移行パターンを検証するための代表例（useTimeline）のみを置く。
// 残り24フックの移植は3.5（画面単位移植）でその画面を移すタイミングに合わせて行う。
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { fetchJson } from "./api";
import type { TimelineEntry } from "@emther/core/types";

function usePolledQuery<T>(queryKey: readonly unknown[], url: string, intervalMs: number, options?: Pick<UseQueryOptions<T>, "enabled">) {
  return useQuery<T>({
    queryKey,
    queryFn: () => fetchJson<T>(url),
    refetchInterval: intervalMs,
    enabled: options?.enabled,
  });
}

// docs/memo.md「N. 時系列変化をEMが読む物語に」対応（旧: web/src/lib/hooks.ts useTimeline）。
export function useTimeline(intervalMs = 10000) {
  const query = usePolledQuery<{ entries: TimelineEntry[] }>(["api", "timeline"], "/api/timeline", intervalMs);
  return {
    entries: query.data?.entries ?? [],
    timelineLoaded: !query.isPending,
    refreshTimeline: query.refetch,
  };
}

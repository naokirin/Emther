// 全APIフェッチの共通入口。TanStack Queryのqueryパターンでは、
// エラーはthrowして呼び出し側（useQuery）のerror状態に委ねるのが標準的な扱い方
// （旧Next側のusePollingは「失敗時は静かに無視」だったが、queries.ts側のドキュメント
// コメントに移行判断の理由を記載）。
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`request failed: ${init?.method ?? "GET"} ${url} (${res.status})`);
  }
  return (await res.json()) as T;
}

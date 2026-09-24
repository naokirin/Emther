import { useCallback, useMemo } from "react";
import { z } from "zod";
import { useTypedSearchParams } from "./useTypedSearchParams";

// 一覧⇄詳細を URL クエリ（例: ?suggestion=<id>）で保持するサイドピーク共通フック。
// useTypedSearchParams 上に実装（useSearchParams は Suspense 不要）。
// timeline 等の「URLでピーク開閉」向け。teams の ?focus= のような一回読みは素の useSearchParams で足りる。
export function usePeekParam(key: string) {
  const schema = useMemo(() => z.object({ [key]: z.string().optional() }), [key]);
  const [values, setParams] = useTypedSearchParams(schema);
  const id = (values as Record<string, string | undefined>)[key] ?? null;

  const open = useCallback((nextId: string) => setParams({ [key]: nextId }), [key, setParams]);
  const close = useCallback(() => setParams({ [key]: undefined }), [key, setParams]);

  return { id, open, close };
}

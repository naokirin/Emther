import { useCallback, useMemo } from "react";
import { z } from "zod";
import { useTypedSearchParams } from "./useTypedSearchParams";

// 旧: web/src/lib/hooks.ts usePeekParam。一覧⇄詳細をURLクエリパラメータ（例: ?issue=<id>）で
// 保持するサイドピーク共通パターン。元実装はnext/navigationのuseRouter/usePathname/
// useSearchParamsを素朴に組み合わせていたが、フェーズ3.3で確立したuseTypedSearchParamsの
// 上に再実装した（react-routerのuseSearchParamsはSuspenseを要求しないため、元実装が
// 必要としていた<Suspense>ラッパーは呼び出し側も含めて不要）。
// docs/2nd_architecture/plan.md フェーズ3.3で列挙した呼び出し候補（chat/journal/org/
// org-thread/teams/ThemesPanel等）のうち、実際に「URLでピーク詳細を開閉する」パターンを
// 使う画面（timeline等）はこの共通フックを使う。teamsのような単純な一回読み取り
// （?focus=）は素のuseSearchParamsで足りるため対象外（TeamsPage.tsx参照）。
export function usePeekParam(key: string) {
  const schema = useMemo(() => z.object({ [key]: z.string().optional() }), [key]);
  const [values, setParams] = useTypedSearchParams(schema);
  const id = (values as Record<string, string | undefined>)[key] ?? null;

  const open = useCallback((nextId: string) => setParams({ [key]: nextId }), [key, setParams]);
  const close = useCallback(() => setParams({ [key]: undefined }), [key, setParams]);

  return { id, open, close };
}

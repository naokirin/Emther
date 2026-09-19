// フェーズ3.3: クエリパラメータ連動（例: /chat?run=… , /journal?focus=…）を
// 型安全に扱うための薄いZodラッパー。docs/2nd_architecture.md 3.3節の方針どおり、
// TanStack Router のような専用ルーティング機構は導入せず、React Router の
// useSearchParams + Zod スキーマで必要な型安全性だけを確保する。
//
// 値はURLSearchParams由来で常に文字列のため型不一致は起きない。旧Next側の
// `searchParams.get(key)`（値が無ければnull）との対応は、フィールドを
// `z.string().optional()` にすることで「無ければundefined」という同じ意味になる。
// enumや数値等、より厳密な検証をしたい呼び出し側は`.optional().catch(undefined)`
// （フェーズ2.6のZod導入で確立した「不正な値は黙って未指定扱いにする」規約）を使う。
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { z } from "zod";

type ParamUpdates<Shape extends z.ZodRawShape> = {
  [K in keyof Shape]?: string | undefined;
};

export function useTypedSearchParams<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  const [searchParams, setSearchParams] = useSearchParams();

  const values = useMemo(() => schema.parse(Object.fromEntries(searchParams)), [searchParams, schema]);

  // undefinedを指定したキーは削除する（Next側の usePeekParam の close() と同じ意味）。
  // 既定でreplace: trueにしているのは、旧実装のrouter.push(..., {scroll:false})が
  // 実質「今の画面のURLを書き換えるだけ」で履歴を積み増す意図が無かったことに合わせるため。
  const setParams = useCallback(
    (updates: ParamUpdates<Shape>, options?: { replace?: boolean }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === undefined) {
              next.delete(key);
            } else {
              next.set(key, value);
            }
          }
          return next;
        },
        { replace: options?.replace ?? true },
      );
    },
    [setSearchParams],
  );

  return [values, setParams] as const;
}

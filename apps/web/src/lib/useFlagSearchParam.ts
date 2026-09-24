// 一覧の「アーカイブ済みも表示」など boolean フィルタを URL に載せる共通フック。
// キーは呼び出し側で指定（既定は archived）。peek / focus / runId など他キーと共存する。
import { useCallback, useMemo } from "react";
import { z } from "zod";
import { useTypedSearchParams } from "./useTypedSearchParams";

export function useFlagSearchParam(key = "archived") {
  const schema = useMemo(() => z.object({ [key]: z.enum(["1"]).optional().catch(undefined) }), [key]);
  const [values, setParams] = useTypedSearchParams(schema);
  const on = (values as Record<string, string | undefined>)[key] === "1";

  const setOn = useCallback(
    (next: boolean) => setParams({ [key]: next ? "1" : undefined }),
    [key, setParams],
  );

  return [on, setOn] as const;
}

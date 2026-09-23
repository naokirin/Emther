import { useEffect, useState } from "react";
import type { SuggestionExportColumnId } from "@emther/core/suggestion-export";
import { loadSuggestionExportColumnIds, saveSuggestionExportColumnIds } from "../lib/suggestionExportColumns";

/** 一覧ページ用: localStorage と同期した列設定フック。 */
export function useSuggestionExportColumns() {
  const [columnIds, setColumnIds] = useState<SuggestionExportColumnId[]>(() => [
    ...loadSuggestionExportColumnIds(),
  ]);

  useEffect(() => {
    saveSuggestionExportColumnIds(columnIds);
  }, [columnIds]);

  return { columnIds, setColumnIds };
}

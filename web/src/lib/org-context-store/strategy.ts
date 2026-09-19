import { loadJSON, saveJSON } from "@core/persistence";
import { maskForStorage } from "@core/people-directory";

// docs 3.1「Core Context」の`Strategy/`ディレクトリに相当する最小実装。
// MVV（Mission/Vision/Values）は組織全体で1つの静的な前提として保持し、
// Agent Runtimeへ常時（Issue非依存で）注入する。空文字列は「未設定」を意味し、
// 未設定の項目はプロンプトに含めない（他のcharter系項目と同じ扱い）。
// OKRはdocs/memo.md「H」対応でObjective/KeyResultとして別途構造化した
// （lib/org-context-store/objectives.ts参照）ため、ここには含まない。
export type OrgStrategy = {
  mission: string;
  vision: string;
  values: string;
};

const DEFAULT_STRATEGY: OrgStrategy = { mission: "", vision: "", values: "" };

let strategy: OrgStrategy = {
  ...DEFAULT_STRATEGY,
  ...loadJSON<Partial<OrgStrategy>>("org-strategy.json", {}),
};

function persistStrategy(): void {
  saveJSON("org-strategy.json", strategy);
}

export function getOrgStrategy(): OrgStrategy {
  return strategy;
}

// Mission/Vision/Valuesは自由記述テキストであり、人物名を含む文章になり得るため
// （例: 「Aさんを技術リードに任命する」）、Teamのmembersとは異なりNERでの検出が必要。
export async function updateOrgStrategy(patch: Partial<OrgStrategy>): Promise<OrgStrategy> {
  strategy = {
    mission: patch.mission !== undefined ? await maskForStorage(patch.mission.trim()) : strategy.mission,
    vision: patch.vision !== undefined ? await maskForStorage(patch.vision.trim()) : strategy.vision,
    values: patch.values !== undefined ? await maskForStorage(patch.values.trim()) : strategy.values,
  };
  persistStrategy();
  return strategy;
}

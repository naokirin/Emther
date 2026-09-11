import { NextResponse } from "next/server";
import { listObjectives } from "@/lib/org-context-store";
import { createThemeCandidate, toThemeView } from "@/lib/theme-store";

// docs/value_hierarchy_and_flow.md §2.3。期初・OKR 更新時に Objective/KR から候補テーマを先に置く。
// 初回はヒューリスティック（AI なし）。人間が採用するまで candidate。

type Body = {
  objectiveIds?: string[];
  /** true のとき Key Result ごとに候補を分割（既定は Objective 単位） */
  perKeyResult?: boolean;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const all = listObjectives();
  const filterIds = Array.isArray(body.objectiveIds)
    ? new Set(body.objectiveIds.filter((id): id is string => typeof id === "string" && !!id))
    : null;
  const objectives = filterIds ? all.filter((o) => filterIds.has(o.id)) : all;

  if (objectives.length === 0) {
    return NextResponse.json({ error: "対象の Objective がありません" }, { status: 400 });
  }

  const themes = [];
  for (const objective of objectives) {
    if (body.perKeyResult && objective.keyResults.length > 0) {
      for (const kr of objective.keyResults) {
        const theme = await createThemeCandidate({
          title: `${objective.title} / ${kr.title}`,
          summary: `Key Result「${kr.title}」に向けた今期の焦点候補（Objective: ${objective.title}）`,
          rationale: "OKR 起点で自動生成した候補。観測差分による週次蒸留で修正する前提。",
          facts: [`Objective: ${objective.title}`, `Key Result: ${kr.title}`],
          suggestedDirection: `「${kr.title}」の達成を阻む組織・プロセス上の詰まりを特定し介入する`,
          objectiveIds: [objective.id],
          keyResultIds: [kr.id],
          teamId: objective.teamId,
        });
        themes.push(toThemeView(theme));
      }
      continue;
    }

    const krLines = objective.keyResults.map((kr) => kr.title);
    const theme = await createThemeCandidate({
      title: objective.title,
      summary: `Objective「${objective.title}」を今期の焦点として解くためのテーマ候補`,
      rationale: "OKR 起点で自動生成した候補。観測差分による週次蒸留で修正する前提。",
      facts: [
        `Objective: ${objective.title}`,
        ...(objective.note ? [`補足: ${objective.note}`] : []),
        ...krLines.map((t) => `KR: ${t}`),
      ],
      suggestedDirection:
        krLines.length > 0
          ? `Key Result（${krLines.join(" / ")}）の達成に効く組織課題を優先する`
          : `Objective「${objective.title}」の達成に効く組織課題を優先する`,
      objectiveIds: [objective.id],
      keyResultIds: objective.keyResults.map((kr) => kr.id),
      teamId: objective.teamId,
    });
    themes.push(toThemeView(theme));
  }

  return NextResponse.json({ themes }, { status: 201 });
}

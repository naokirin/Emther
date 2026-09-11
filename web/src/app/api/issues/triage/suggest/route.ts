import { NextResponse } from "next/server";
import { suggestTriageForActiveParents, toIssueView } from "@/lib/issue-store";
import { ISSUE_PRIORITY_META } from "@/lib/types";

// docs/value_hierarchy_and_flow.md §4。ルールベースで triage を書き、focus 候補を返す。
// body.applySuggested=true のとき suggestedPriority を priority に反映（例外上書き前の一括提案）。

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const applySuggested = body?.applySuggested === true;
  const focusLimit =
    typeof body?.focusLimit === "number" && body.focusLimit > 0 ? Math.min(20, Math.floor(body.focusLimit)) : 5;

  const result = suggestTriageForActiveParents({ applySuggested, focusLimit });

  return NextResponse.json({
    issues: result.issues.map(toIssueView),
    focusCandidates: result.focusCandidates.map((i) => ({
      id: i.id,
      title: i.title,
      priority: i.priority,
      suggestedPriority: i.triage?.suggestedPriority,
      score: i.triage?.score ?? 0,
      costOfDelay: i.triage?.costOfDelay ?? 0,
      effort: i.triage?.effort ?? 0,
      blastRadius: i.triage?.blastRadius ?? 0,
      confidence: i.triage?.confidence ?? 0,
    })),
    counts: result.counts,
    differing: result.differing.map((d) => {
      const issue = result.issues.find((i) => i.id === d.issueId);
      return {
        ...d,
        currentLabel: ISSUE_PRIORITY_META[d.current].label,
        suggestedLabel: ISSUE_PRIORITY_META[d.suggested].label,
        effectiveLabel: ISSUE_PRIORITY_META[d.effective].label,
        costOfDelay: issue?.triage?.costOfDelay ?? 0,
        effort: issue?.triage?.effort ?? 0,
        blastRadius: issue?.triage?.blastRadius ?? 0,
        confidence: issue?.triage?.confidence ?? 0,
      };
    }),
    changes: result.changes.map((c) => ({
      ...c,
      fromLabel: ISSUE_PRIORITY_META[c.from].label,
      toLabel: ISSUE_PRIORITY_META[c.to].label,
    })),
    applied: applySuggested,
    focusLimit,
  });
}

import { NextResponse } from "next/server";
import { importObjectives, toObjectiveView, type ObjectiveImportDraft } from "@/lib/org-context-store";

function normalizeDrafts(raw: unknown): ObjectiveImportDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title.trim() : "";
      if (!title) return null;
      const noteRaw = (item as { note?: unknown }).note;
      const note = typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim() : undefined;
      const keyResults = Array.isArray((item as { keyResults?: unknown }).keyResults)
        ? ((item as { keyResults: unknown[] }).keyResults)
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
      return { title, ...(note ? { note } : {}), keyResults } satisfies ObjectiveImportDraft;
    })
    .filter((d): d is ObjectiveImportDraft => !!d);
}

// docs/usage_issues U18: プレビュー済みドラフトを追記または同一スコープ差し替えで保存する。
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const mode = body?.mode === "replace" ? "replace" : body?.mode === "append" ? "append" : null;
  if (!mode) {
    return NextResponse.json({ error: "modeは append または replace です" }, { status: 400 });
  }
  const drafts = normalizeDrafts(body?.objectives);
  if (drafts.length === 0) {
    return NextResponse.json({ error: "objectives（title付き）が1件以上必要です" }, { status: 400 });
  }
  const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : undefined;
  const created = await importObjectives(drafts, { mode, teamId });
  return NextResponse.json({ objectives: created.map(toObjectiveView) }, { status: 201 });
}

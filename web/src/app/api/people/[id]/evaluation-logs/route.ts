import { NextResponse } from "next/server";
import { getPersonProfile } from "@/lib/people-hub";
import {
  bundleEvaluationLogs,
  listEvaluationLogsForPerson,
  suggestEvaluationLogsFromRecentJournals,
  toEvaluationLogView,
  type EvaluationLens,
  type EvaluationLogStatus,
} from "@/lib/person-evaluation-store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const profile = getPersonProfile(id);
  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(request.url);
  const lens = url.searchParams.get("lens") as EvaluationLens | null;
  const status = url.searchParams.get("status") as EvaluationLogStatus | null;
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");
  const bundle = url.searchParams.get("bundle") === "1";

  if (bundle) {
    const result = bundleEvaluationLogs(id, {
      since: since ? Number(since) : undefined,
      until: until ? Number(until) : undefined,
    });
    return NextResponse.json({
      outcome: result.outcome.map(toEvaluationLogView),
      value: result.value.map(toEvaluationLogView),
      missing: result.missing,
    });
  }

  const logs = listEvaluationLogsForPerson(id, {
    lens: lens === "outcome" || lens === "value" ? lens : undefined,
    status:
      status === "provisional" || status === "confirmed" || status === "discarded" ? status : undefined,
    since: since ? Number(since) : undefined,
    until: until ? Number(until) : undefined,
  });
  return NextResponse.json({ logs: logs.map(toEvaluationLogView) });
}

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const profile = getPersonProfile(id);
  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  if (body?.action === "suggest-from-journal") {
    const created = await suggestEvaluationLogsFromRecentJournals(id, profile.name);
    return NextResponse.json({ logs: created.map(toEvaluationLogView) }, { status: 201 });
  }

  return NextResponse.json({ error: "action は suggest-from-journal です" }, { status: 400 });
}

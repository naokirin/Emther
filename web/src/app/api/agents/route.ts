import { NextResponse } from "next/server";
import { listPendingAgentStarts, listPendingUnmaskedSends, listRuns, startRun, toRunView } from "@/lib/agent-runtime";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";

export async function GET() {
  return NextResponse.json({
    runs: listRuns().map(toRunView),
    pendingAgentStarts: listPendingAgentStarts(),
    pendingUnmaskedSends: listPendingUnmaskedSends(),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const agentName = typeof body?.agentName === "string" ? body.agentName.trim() : "";
  const task = typeof body?.task === "string" ? body.task.trim() : "";

  if (!agentName || !task) {
    return NextResponse.json({ error: "agentNameとtaskは必須です" }, { status: 400 });
  }

  try {
    const run = await startRun(agentName, task, "manual", undefined, {
      ...maskOptionsFromBody(body),
    });
    return NextResponse.json({ run: toRunView(run) }, { status: 201 });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

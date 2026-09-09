import { NextResponse } from "next/server";
import { listPendingAgentStarts, listRuns, startRun, toRunView } from "@/lib/agent-runtime";

export async function GET() {
  return NextResponse.json({
    runs: listRuns().map(toRunView),
    pendingAgentStarts: listPendingAgentStarts(),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const agentName = typeof body?.agentName === "string" ? body.agentName.trim() : "";
  const task = typeof body?.task === "string" ? body.task.trim() : "";

  if (!agentName || !task) {
    return NextResponse.json({ error: "agentNameとtaskは必須です" }, { status: 400 });
  }

  const run = await startRun(agentName, task);
  return NextResponse.json({ run: toRunView(run) }, { status: 201 });
}

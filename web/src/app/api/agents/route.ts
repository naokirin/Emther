import { NextResponse } from "next/server";
import { listPendingAgentStarts, listPendingUnmaskedSends, listRuns, startRun, toRunView } from "@core/agent-runtime/index";
import { jsonFromUnknownError, maskOptionsFromBodyStrict } from "@/app/api/name-candidate-response";
import { EXEC_AGENT_NAME } from "@core/types";

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
  const sourceJournalId =
    typeof body?.sourceJournalId === "string" && body.sourceJournalId.trim() ? body.sourceJournalId.trim() : undefined;
  // 何でも相談の「経営／役員目線の厳しいレビューも聞く」チェック。LeadがExec Agentを必須consultする。
  const requireExecConsult = body?.requireExecConsult === true;

  if (!agentName || !task) {
    return NextResponse.json({ error: "agentNameとtaskは必須です" }, { status: 400 });
  }

  try {
    const run = await startRun(agentName, task, "manual", undefined, {
      ...maskOptionsFromBodyStrict(body),
      sourceJournalId,
      ...(requireExecConsult && agentName === "Lead Agent"
        ? { requiredConsultAgents: [EXEC_AGENT_NAME] }
        : {}),
    });
    return NextResponse.json({ run: toRunView(run) }, { status: 201 });
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}

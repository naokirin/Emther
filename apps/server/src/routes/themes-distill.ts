import { Hono } from "hono";
import type { AgentRunMutationResponse, PendingUnmaskedResponse } from "@emther/api-contract";
import { startDistillationAnalysis, toRunView } from "@emther/core/agent-runtime/index";
import { isUnconfirmedNameCandidatesError } from "@emther/core/name-candidate-confirmation";

export const themesDistillRoute = new Hono().post("/", async (c) => {
  try {
    const run = await startDistillationAnalysis({ manual: true });
    if (!run) {
      const pendingBody = { pendingUnmasked: true } satisfies PendingUnmaskedResponse;
      return c.json(pendingBody, 202);
    }
    const resBody = { run: toRunView(run) } satisfies AgentRunMutationResponse;
    return c.json(resBody, 201);
  } catch (err) {
    if (isUnconfirmedNameCandidatesError(err)) {
      return c.json({ error: err.message, candidates: err.candidates }, 409);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
});

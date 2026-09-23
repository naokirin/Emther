import { useCallback, useState } from "react";
import {
  NameCandidateConfirmDialog,
  type NameCandidateDecision,
} from "../components/NameCandidateConfirmDialog";
import { isNameCandidateConfirmation } from "@emther/core/name-candidate-confirmation";
import { api, rpcInit } from "./api-client";

type PendingAsk = {
  candidates: string[];
  actionLabel: string;
  resolve: (decision: NameCandidateDecision | false) => void;
};

/**
 * fetchWithNameConfirm に渡される URL + method を Hono RPC に振り分ける。
 * 呼び出し側は従来どおり URL 文字列を渡せる。
 */
async function rpcByUrl(
  url: string,
  method: string,
  json: Record<string, unknown>,
): Promise<Response> {
  const m = method.toUpperCase();

  if (url === "/api/journal" && m === "POST") {
    return api.api.journal.$post({ json });
  }
  if (url === "/api/agents" && m === "POST") {
    return api.api.agents.$post({ json });
  }
  if (url === "/api/suggestions" && m === "POST") {
    return api.api.suggestions.$post({ json });
  }
  if (url === "/api/journal/dumps" && m === "POST") {
    return api.api.journal.dumps.$post({ json });
  }

  const journalId = url.match(/^\/api\/journal\/([^/]+)$/);
  if (journalId && m === "PATCH") {
    return api.api.journal[":id"].$patch(rpcInit({ param: { id: journalId[1]! }, json }));
  }

  const journalAnalyze = url.match(/^\/api\/journal\/([^/]+)\/analyze$/);
  if (journalAnalyze && m === "POST") {
    return api.api.journal[":id"].analyze.$post(rpcInit({ param: { id: journalAnalyze[1]! }, json }));
  }

  const agentDecide = url.match(/^\/api\/agents\/([^/]+)\/decide$/);
  if (agentDecide && m === "POST") {
    return api.api.agents[":id"].decide.$post(rpcInit({ param: { id: agentDecide[1]! }, json }));
  }

  const suggestionId = url.match(/^\/api\/suggestions\/([^/]+)$/);
  if (suggestionId && m === "PATCH") {
    return api.api.suggestions[":id"].$patch(rpcInit({ param: { id: suggestionId[1]! }, json }));
  }

  const suggestionMemo = url.match(/^\/api\/suggestions\/([^/]+)\/memo$/);
  if (suggestionMemo && m === "POST") {
    return api.api.suggestions[":id"].memo.$post(rpcInit({ param: { id: suggestionMemo[1]! }, json }));
  }

  const dumpAccept = url.match(/^\/api\/journal\/dumps\/([^/]+)\/accept$/);
  if (dumpAccept && m === "POST") {
    return api.api.journal.dumps[":id"].accept.$post(rpcInit({ param: { id: dumpAccept[1]! }, json }));
  }

  throw new Error(`Unsupported name-confirm RPC: ${m} ${url}`);
}

/**
 * 409 + NAME_CANDIDATE_CONFIRMATION_REQUIRED を受けたらダイアログで確認し、
 * 許可時は allowUnmaskedNameCandidates / registerNameCandidates で同じ body を再送する。
 */
export function useNameCandidateConfirm() {
  const [pending, setPending] = useState<PendingAsk | null>(null);

  const askDecision = useCallback((candidates: string[], actionLabel: string) => {
    return new Promise<NameCandidateDecision | false>((resolve) => {
      setPending({ candidates, actionLabel, resolve });
    });
  }, []);

  const fetchWithNameConfirm = useCallback(
    async (
      url: string,
      init: { method?: string; body: Record<string, unknown> },
      actionLabel: string,
    ): Promise<{ res: Response; data: unknown }> => {
      const send = async (decision: NameCandidateDecision | false) => {
        const res = await rpcByUrl(url, init.method ?? "POST", {
          ...init.body,
          ...(decision === "allow" ? { allowUnmaskedNameCandidates: true } : {}),
          ...(decision === "register" ? { registerNameCandidates: true } : {}),
        });
        const data = await res.json().catch(() => null);
        return { res, data };
      };

      let result = await send(false);
      if (result.res.status === 409 && isNameCandidateConfirmation(result.data)) {
        const decision = await askDecision(result.data.candidates, actionLabel);
        if (!decision) {
          throw new Error("人名候補の確認をキャンセルしました");
        }
        result = await send(decision);
      }
      return result;
    },
    [askDecision],
  );

  const dialog = pending ? (
    <NameCandidateConfirmDialog
      candidates={pending.candidates}
      actionLabel={pending.actionLabel}
      onAllow={() => {
        pending.resolve("allow");
        setPending(null);
      }}
      onRegister={() => {
        pending.resolve("register");
        setPending(null);
      }}
      onCancel={() => {
        pending.resolve(false);
        setPending(null);
      }}
    />
  ) : null;

  return { fetchWithNameConfirm, nameCandidateDialog: dialog };
}

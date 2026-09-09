"use client";

import { useCallback, useState } from "react";
import {
  NameCandidateConfirmDialog,
  type NameCandidateDecision,
} from "@/components/NameCandidateConfirmDialog";
import { isNameCandidateConfirmation } from "@/lib/name-candidate-confirmation";

type PendingAsk = {
  candidates: string[];
  actionLabel: string;
  resolve: (decision: NameCandidateDecision | false) => void;
};

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
        const res = await fetch(url, {
          method: init.method ?? "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...init.body,
            ...(decision === "allow" ? { allowUnmaskedNameCandidates: true } : {}),
            ...(decision === "register" ? { registerNameCandidates: true } : {}),
          }),
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

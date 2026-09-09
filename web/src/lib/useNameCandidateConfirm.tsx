"use client";

import { useCallback, useState } from "react";
import { NameCandidateConfirmDialog } from "@/components/NameCandidateConfirmDialog";
import { isNameCandidateConfirmation } from "@/lib/name-candidate-confirmation";

type PendingAsk = {
  candidates: string[];
  actionLabel: string;
  resolve: (allowed: boolean) => void;
};

/**
 * 409 + NAME_CANDIDATE_CONFIRMATION_REQUIRED を受けたらダイアログで確認し、
 * 許可時は allowUnmaskedNameCandidates: true で同じ body を再送する。
 */
export function useNameCandidateConfirm() {
  const [pending, setPending] = useState<PendingAsk | null>(null);

  const askAllowUnmasked = useCallback((candidates: string[], actionLabel: string) => {
    return new Promise<boolean>((resolve) => {
      setPending({ candidates, actionLabel, resolve });
    });
  }, []);

  const fetchWithNameConfirm = useCallback(
    async (
      url: string,
      init: { method?: string; body: Record<string, unknown> },
      actionLabel: string,
    ): Promise<{ res: Response; data: unknown }> => {
      const send = async (allow: boolean) => {
        const res = await fetch(url, {
          method: init.method ?? "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...init.body,
            ...(allow ? { allowUnmaskedNameCandidates: true } : {}),
          }),
        });
        const data = await res.json().catch(() => null);
        return { res, data };
      };

      let result = await send(false);
      if (result.res.status === 409 && isNameCandidateConfirmation(result.data)) {
        const allowed = await askAllowUnmasked(result.data.candidates, actionLabel);
        if (!allowed) {
          throw new Error("人名候補の確認をキャンセルしました");
        }
        result = await send(true);
      }
      return result;
    },
    [askAllowUnmasked],
  );

  const dialog = pending ? (
    <NameCandidateConfirmDialog
      candidates={pending.candidates}
      actionLabel={pending.actionLabel}
      onAllow={() => {
        pending.resolve(true);
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

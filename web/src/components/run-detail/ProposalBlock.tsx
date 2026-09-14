"use client";

import { IdLinkedText } from "@/components/IdLinkedText";
import type { Proposal } from "@/components/RunDetail";
import { listIssueCandidatesFromProposal } from "./run-view-helpers";

// 結論・参照ファクト・判断ロジック・棄却した代替案・Issue化候補の表示。
// 呼び出し側（ExecutionState）が`<div className={styles.proposalBlock}>`で囲み、
// このコンポーネントの直後に各種「AIが提案するX」ブロックを並べるDOM構造を保つため、
// ここでは外側のdivは持たずFragmentのみ返す。
export function ProposalBlock({ proposal }: { proposal: Proposal }) {
  const candidates = listIssueCandidatesFromProposal(proposal);
  return (
    <>
      <strong>✅ 結論</strong>
      <p style={{ fontSize: "0.875rem", marginTop: 4 }}>
        <IdLinkedText text={proposal.conclusion} />
      </p>

      {proposal.facts.length > 0 && (
        <>
          <strong style={{ fontSize: "0.75rem" }}>参照ファクト</strong>
          <ul style={{ margin: "4px 0 8px 18px", fontSize: "0.75rem" }}>
            {proposal.facts.map((f, i) => (
              <li key={i}>
                <IdLinkedText text={f} />
              </li>
            ))}
          </ul>
        </>
      )}

      <strong style={{ fontSize: "0.75rem" }}>判断ロジック</strong>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "4px 0 8px" }}>
        <IdLinkedText text={proposal.logic} />
      </p>

      {proposal.rejectedAlternatives.length > 0 && (
        <>
          <strong style={{ fontSize: "0.75rem" }}>棄却した代替案</strong>
          {proposal.rejectedAlternatives.map((r, i) => (
            <div key={i} style={{ fontSize: "0.75rem", marginTop: 4 }}>
              <strong>
                <IdLinkedText text={r.option} />
              </strong>
              <span style={{ color: "var(--text-muted)" }}>
                {" "}
                — <IdLinkedText text={r.reason} />
              </span>
            </div>
          ))}
        </>
      )}

      {candidates.length > 1 && (
        <>
          <strong style={{ fontSize: "0.75rem" }}>Issue化候補（親なし・独立）</strong>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "4px 0 6px" }}>
            別介入として並列に切る案です。子Issue（分解）ではありません。起票する件は相談画面のチェックで選んでください。
          </p>
          <ul style={{ margin: "0 0 8px 18px", fontSize: "0.75rem" }}>
            {candidates.map((c, i) => (
              <li key={i}>
                <IdLinkedText text={c.title} />
                {c.rationale ? (
                  <span style={{ color: "var(--text-muted)" }}>
                    {" "}
                    — <IdLinkedText text={c.rationale} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

"use client";

import { IdLinkedText } from "@/components/IdLinkedText";
import type { Proposal } from "@/components/RunDetail";
import { listIssueCandidatesFromProposal } from "./run-view-helpers";

// 結論・参照ファクト・Expand/Challenge・判断ロジック・棄却した代替案・Issue化候補の表示。
// 呼び出し側（ExecutionState）が`<div className={styles.proposalBlock}>`で囲み、
// このコンポーネントの直後に各種「AIが提案するX」ブロックを並べるDOM構造を保つため、
// ここでは外側のdivは持たずFragmentのみ返す。
export function ProposalBlock({ proposal }: { proposal: Proposal }) {
  const candidates = listIssueCandidatesFromProposal(proposal);
  const expansions = proposal.expansions ?? [];
  const challenges = proposal.challenges ?? [];
  const hasDetails =
    proposal.facts.length > 0 ||
    expansions.length > 0 ||
    challenges.length > 0 ||
    Boolean(proposal.logic) ||
    proposal.rejectedAlternatives.length > 0;

  return (
    <>
      <div
        style={{
          padding: "12px 14px",
          backgroundColor: "var(--surface)",
          borderRadius: 8,
          border: "1px solid var(--border)",
          borderLeft: "4px solid var(--accent)",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <strong style={{ fontSize: "0.95rem", color: "var(--fg)" }}>✅ 結論</strong>
        </div>
        <p style={{ fontSize: "1rem", lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
          <IdLinkedText text={proposal.conclusion} />
        </p>

        {proposal.advice && (
          <div
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px dashed var(--border)",
              fontSize: "0.85rem",
              color: "var(--fg)",
            }}
          >
            <strong style={{ color: "var(--accent)" }}>💡 進め方のアドバイス: </strong>
            <IdLinkedText text={proposal.advice} />
          </div>
        )}
      </div>

      {hasDetails && (
        <details
          style={{
            margin: "8px 0 12px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 12px",
            background: "var(--bg-subtle, transparent)",
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              fontWeight: 500,
              userSelect: "none",
            }}
          >
            🔍 AIの思考プロセス・判断根拠を確認する
            {proposal.facts.length > 0 ? `（参照ファクト ${proposal.facts.length}件）` : ""}
          </summary>

          <div style={{ marginTop: 10 }}>
            {proposal.facts.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: "0.75rem" }}>参照ファクト</strong>
                <ul style={{ margin: "4px 0 8px 18px", fontSize: "0.75rem" }}>
                  {proposal.facts.map((f, i) => (
                    <li key={i}>
                      <IdLinkedText text={f} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {proposal.logic && (
              <div style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: "0.75rem" }}>判断ロジック</strong>
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "4px 0 8px" }}>
                  <IdLinkedText text={proposal.logic} />
                </p>
              </div>
            )}

            {expansions.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: "0.75rem" }}>🔭 視点の広がり（Expand）</strong>
                <ul style={{ margin: "4px 0 8px 18px", fontSize: "0.75rem" }}>
                  {expansions.map((e, i) => (
                    <li key={i}>
                      <IdLinkedText text={e} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {challenges.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: "0.75rem" }}>❓ 前提への問い（Challenge）</strong>
                <ul style={{ margin: "4px 0 8px 18px", fontSize: "0.75rem" }}>
                  {challenges.map((c, i) => (
                    <li key={i}>
                      <IdLinkedText text={c} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {proposal.rejectedAlternatives.length > 0 && (
              <div style={{ marginBottom: 6 }}>
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
              </div>
            )}
          </div>
        </details>
      )}

      {candidates.length > 1 && (
        <div style={{ marginTop: 8 }}>
          <strong style={{ fontSize: "0.75rem" }}>提案化候補（親なし・独立）</strong>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "4px 0 6px" }}>
            別介入として並列に切る案です。子提案（分解）ではありません。起票する件は相談画面のチェックで選んでください。
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
        </div>
      )}
    </>
  );
}

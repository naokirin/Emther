import { useState } from "react";
import { IdLinkedText } from "../IdLinkedText";
import { AdviceBlock } from "../AdviceBlock";
import styles from "../../styles/page.module.css";
import type { Proposal } from "@emther/core/agent-runtime";
import { ExplorationFindingsList } from "./ExplorationFindingsList";
import { listSuggestionCandidatesFromProposal } from "./run-view-helpers";

type DetailTab = "conclusion" | "rethink" | "explore" | "evidence";

// 結論・参照ファクト・Expand/Challenge/Explore・判断ロジック・棄却した代替案・提案化候補の表示。
// 提案詳細（SuggestionDetailContent）と同じ「結論・進め方 / 問い直し / 探索 / 根拠」タブ構成にし、
// 相談画面でも読みやすさを揃える。呼び出し側（ExecutionState）が
// `<div className={styles.proposalBlock}>`で囲み、このコンポーネントの直後に各種
// 「AIが提案するX」ブロックを並べるDOM構造を保つため、外側のdivは持たずFragmentのみ返す。
export function ProposalBlock({ proposal }: { proposal: Proposal }) {
  const [detailTab, setDetailTab] = useState<DetailTab>("conclusion");
  const candidates = listSuggestionCandidatesFromProposal(proposal);
  const expansions = proposal.expansions ?? [];
  const challenges = proposal.challenges ?? [];
  const explorations = proposal.explorations ?? [];
  const lensesUsed = proposal.lensesUsed ?? [];
  const rethinkCount = expansions.length + challenges.length;
  const exploreCount = explorations.length;
  const evidenceCount =
    proposal.facts.length +
    (proposal.logic.trim() ? 1 : 0) +
    lensesUsed.length +
    proposal.rejectedAlternatives.length;
  const rethinkTabLabel = rethinkCount > 0 ? `問い直し（${rethinkCount}）` : "問い直し";
  const exploreTabLabel = exploreCount > 0 ? `探索（${exploreCount}）` : "探索";
  const evidenceTabLabel = evidenceCount > 0 ? `根拠（${evidenceCount}）` : "根拠";

  return (
    <>
      <div className={styles.tabs} style={{ margin: "0 0 12px" }} role="tablist" aria-label="結論の内訳">
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === "conclusion"}
          className={`${styles.tabBtn} ${detailTab === "conclusion" ? styles.tabBtnActive : ""}`}
          onClick={() => setDetailTab("conclusion")}
        >
          結論・進め方
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === "rethink"}
          className={`${styles.tabBtn} ${detailTab === "rethink" ? styles.tabBtnActive : ""}`}
          onClick={() => setDetailTab("rethink")}
        >
          {rethinkTabLabel}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === "explore"}
          className={`${styles.tabBtn} ${detailTab === "explore" ? styles.tabBtnActive : ""}`}
          onClick={() => setDetailTab("explore")}
        >
          {exploreTabLabel}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === "evidence"}
          className={`${styles.tabBtn} ${detailTab === "evidence" ? styles.tabBtnActive : ""}`}
          onClick={() => setDetailTab("evidence")}
        >
          {evidenceTabLabel}
        </button>
      </div>

      {detailTab === "conclusion" && (
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

          <AdviceBlock
            presentation="summary"
            fields={{
              advice: proposal.advice,
              adviceStructured: proposal.adviceStructured,
            }}
          />
        </div>
      )}

      {detailTab === "rethink" && (
        <div style={{ marginBottom: 12 }}>
          <p className={styles.subtitle} style={{ marginBottom: 10 }}>
            結論をいったん横に置き、前提や視点を見直すための示唆です。
          </p>
          {rethinkCount === 0 ? (
            <p className={styles.subtitle}>まだ問い直しの示唆はありません。</p>
          ) : (
            <>
              {expansions.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <strong style={{ fontSize: "0.85rem" }}>🔭 視点の広がり（Expand）</strong>
                  <ul style={{ margin: "6px 0 0 18px", fontSize: "0.875rem", lineHeight: 1.55 }}>
                    {expansions.map((e, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        <IdLinkedText text={e} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {challenges.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <strong style={{ fontSize: "0.85rem" }}>❓ 前提への問い（Challenge）</strong>
                  <ul style={{ margin: "6px 0 0 18px", fontSize: "0.875rem", lineHeight: 1.55 }}>
                    {challenges.map((c, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        <IdLinkedText text={c} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {detailTab === "explore" && (
        <div style={{ marginBottom: 12 }}>
          <p className={styles.subtitle} style={{ marginBottom: 10 }}>
            現在の思考の外側で、まだ見えていない可能性のある観測ギャップです。重要課題と断定するものではありません。
          </p>
          <ExplorationFindingsList findings={explorations} />
        </div>
      )}

      {detailTab === "evidence" && (
        <div style={{ marginBottom: 12 }}>
          {evidenceCount === 0 ? (
            <p className={styles.subtitle}>まだ根拠はありません。</p>
          ) : (
            <>
              {proposal.facts.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <strong style={{ fontSize: "0.85rem" }}>参照ファクト</strong>
                  <ul style={{ margin: "6px 0 0 18px", fontSize: "0.875rem", lineHeight: 1.55 }}>
                    {proposal.facts.map((f, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        <IdLinkedText text={f} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {proposal.logic.trim() && (
                <div style={{ marginBottom: 14 }}>
                  <strong style={{ fontSize: "0.85rem" }}>判断ロジック</strong>
                  <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", margin: "6px 0 0", lineHeight: 1.55 }}>
                    <IdLinkedText text={proposal.logic} />
                  </p>
                </div>
              )}

              {lensesUsed.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <strong style={{ fontSize: "0.85rem" }}>🧭 使用した哲学レンズ</strong>
                  <ul style={{ margin: "6px 0 0 18px", fontSize: "0.875rem", lineHeight: 1.55 }}>
                    {lensesUsed.map((l, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        <strong>{l.lens}</strong>: <IdLinkedText text={l.insight} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {proposal.rejectedAlternatives.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <strong style={{ fontSize: "0.85rem" }}>棄却した代替案</strong>
                  {proposal.rejectedAlternatives.map((r, i) => (
                    <div key={i} style={{ fontSize: "0.875rem", marginTop: 6, lineHeight: 1.55 }}>
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
            </>
          )}
        </div>
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

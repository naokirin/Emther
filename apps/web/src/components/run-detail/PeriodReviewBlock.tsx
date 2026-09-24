import { IdLinkedText } from "../IdLinkedText";
import type { PeriodReview } from "@emther/core/agent-runtime";

const ASSESSMENT_META: Record<PeriodReview["comparisons"][number]["assessment"], { icon: string; label: string }> = {
  improved: { icon: "📈", label: "改善した可能性" },
  worsened: { icon: "📉", label: "悪化した可能性" },
  changed: { icon: "🔄", label: "変化した" },
  uncertain: { icon: "❔", label: "判断が難しい" },
};

// 解釈（interpretation）・Before/After・見落としの問い・学び・次期間への問いを
// ProposalBlockと同じ「事実／解釈を区別して見せる」方針で並べる。呼び出し側
// （ExecutionState）が外側のdivを持つため、ここでもFragmentのみ返す
export function PeriodReviewBlock({ review }: { review: PeriodReview }) {
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
        <strong style={{ fontSize: "0.95rem", color: "var(--fg)" }}>🗓️ この期間の概観</strong>
        <p style={{ fontSize: "1rem", lineHeight: 1.6, margin: "4px 0 0", fontWeight: 500 }}>
          <IdLinkedText text={review.overview} />
        </p>

        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
          <strong style={{ fontSize: "0.85rem", color: "var(--accent)" }}>🔍 横断的な解釈（仮説）</strong>
          <p style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
            <IdLinkedText text={review.interpretation} />
          </p>
        </div>
      </div>

      {review.observations.length > 0 && (
        <details style={{ margin: "8px 0 12px", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 500 }}>
            📋 参照した事実（{review.observations.length}件）
          </summary>
          <ul style={{ margin: "8px 0 0 18px", fontSize: "0.75rem" }}>
            {review.observations.map((o, i) => (
              <li key={i}>
                <IdLinkedText text={o} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {review.comparisons.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: "0.8rem" }}>⚖️ 前期間との比較（Before → After）</strong>
          {review.comparisons.map((c, i) => (
            <div
              key={i}
              style={{
                fontSize: "0.8rem",
                marginTop: 6,
                padding: "6px 10px",
                border: "1px solid var(--border)",
                borderRadius: 6,
              }}
            >
              <strong>
                <IdLinkedText text={c.area} />
              </strong>
              <span style={{ marginLeft: 6, color: "var(--text-muted)" }}>
                {ASSESSMENT_META[c.assessment].icon} {ASSESSMENT_META[c.assessment].label}
              </span>
              <div style={{ marginTop: 4, color: "var(--text-muted)" }}>
                <IdLinkedText text={c.before} /> → <IdLinkedText text={c.after} />
              </div>
            </div>
          ))}
        </div>
      )}

      {review.blindSpots.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: "0.8rem" }}>🕳️ 見落としていそうなこと（問い）</strong>
          <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: "2px 0 6px" }}>
            「問題がない」のか「観測できていない」のかは断定していません。
          </p>
          {review.blindSpots.map((b, i) => (
            <div key={i} style={{ fontSize: "0.8rem", marginTop: 4 }}>
              ・<IdLinkedText text={b.question} />
              <span style={{ color: "var(--text-muted)" }}>
                {" "}
                （<IdLinkedText text={b.reason} />）
              </span>
            </div>
          ))}
        </div>
      )}

      {review.learnings.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: "0.8rem" }}>💡 この期間の学び</strong>
          <ul style={{ margin: "4px 0 0 18px", fontSize: "0.8rem" }}>
            {review.learnings.map((l, i) => (
              <li key={i}>
                <IdLinkedText text={l} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.nextQuestions.length > 0 && (
        <div>
          <strong style={{ fontSize: "0.8rem" }}>➡️ 次の期間へ持ち越す問い</strong>
          <ul style={{ margin: "4px 0 0 18px", fontSize: "0.8rem" }}>
            {review.nextQuestions.map((q, i) => (
              <li key={i}>
                <IdLinkedText text={q} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

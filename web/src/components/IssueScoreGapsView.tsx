"use client";

import styles from "@/app/page.module.css";
import { IssuePriorityBadge, TRIAGE_AXIS_META } from "@/components/IssueStatus";
import {
  buildGapAnnotations,
  buildRankedRows,
  classifyScoreGap,
  deltaFromPrevious,
  layoutQuadrantBubbles,
  summarizeGaps,
  type RankedScoreRow,
} from "@/lib/issue-score-gaps";
import { ISSUE_PRIORITY_META, type Issue, type IssuePriority } from "@/lib/types";

const DEFAULT_VISIBLE = 12;
const QUAD_THRESHOLD = 0.5;

/** 確信度 → 塗り色（高いほど濃い青、低いほど灰色寄り）。内部名は confidence のまま。 */
function confidenceFill(confidence: number): string {
  const c = Math.max(0, Math.min(1, confidence));
  const lightness = 72 - c * 36;
  const saturation = 18 + c * 52;
  return `hsl(214 ${saturation}% ${lightness}%)`;
}

function QuadrantBubbleChart({
  rows,
  onSelect,
}: {
  rows: RankedScoreRow[];
  onSelect: (id: string) => void;
}) {
  const w = 640;
  const h = 420;
  const pad = { top: 36, right: 28, bottom: 44, left: 52 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const midX = pad.left + QUAD_THRESHOLD * innerW;
  const midY = pad.top + (1 - QUAD_THRESHOLD) * innerH;

  const layout = layoutQuadrantBubbles(rows, {
    padLeft: pad.left,
    padTop: pad.top,
    innerW,
    innerH,
  });
  const byId = new Map(rows.map((r, i) => [r.id, { row: r, rank: i + 1 }]));
  // 大きいバブルを先に描き、小さい／前面の視認性を確保
  const drawOrder = [...layout].sort((a, b) => b.r - a.r || a.rank - b.rank);

  const quadLabelStyle = { fontSize: 11, fill: "var(--text-muted)" } as const;

  return (
    <div className={styles.scoreGapScatter}>
      <div className={styles.fieldCaption}>放置リスク × 介入コスト</div>
      <p className={styles.subtitle} style={{ margin: "2px 0 8px" }}>
        バブルの大きさは影響半径、色の濃さは確信度です。右上ほど放置リスクが高く介入が軽い（コスパがよい）です。中庸の値は読みやすいよう外側へ広げ、ほぼ同位置の点だけわずかにずらします（重なりは許容）。
      </p>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height="auto"
        role="img"
        aria-label="放置リスクを縦軸、介入コスト（右が低い）を横軸にした4象限バブル図。大きさは影響半径、色は確信度"
        className={styles.scoreGapScatterSvg}
      >
        {/* 象限背景（右＝介入低） */}
        <rect
          x={pad.left}
          y={pad.top}
          width={midX - pad.left}
          height={midY - pad.top}
          className={styles.scoreGapQuadPlan}
        />
        <rect
          x={midX}
          y={pad.top}
          width={pad.left + innerW - midX}
          height={midY - pad.top}
          className={styles.scoreGapQuadDo}
        />
        <rect
          x={pad.left}
          y={midY}
          width={midX - pad.left}
          height={pad.top + innerH - midY}
          className={styles.scoreGapQuadPark}
        />
        <rect
          x={midX}
          y={midY}
          width={pad.left + innerW - midX}
          height={pad.top + innerH - midY}
          className={styles.scoreGapQuadFill}
        />

        <text x={pad.left + 8} y={pad.top + 16} style={quadLabelStyle}>
          計画してやる
        </text>
        <text x={pad.left + innerW - 8} y={pad.top + 16} textAnchor="end" style={quadLabelStyle}>
          すぐやる
        </text>
        <text x={pad.left + 8} y={pad.top + innerH - 8} style={quadLabelStyle}>
          保留候補
        </text>
        <text x={pad.left + innerW - 8} y={pad.top + innerH - 8} textAnchor="end" style={quadLabelStyle}>
          空きで消化
        </text>

        {/* 十字 */}
        <line x1={midX} y1={pad.top} x2={midX} y2={pad.top + innerH} className={styles.scoreGapScatterAxis} />
        <line x1={pad.left} y1={midY} x2={pad.left + innerW} y2={midY} className={styles.scoreGapScatterAxis} />
        <rect
          x={pad.left}
          y={pad.top}
          width={innerW}
          height={innerH}
          fill="none"
          className={styles.scoreGapScatterFrame}
        />

        <text x={pad.left + innerW / 2} y={h - 12} textAnchor="middle" className={styles.scoreGapScatterAxisLabel}>
          ← 介入コスト（右が低い）
        </text>
        <text
          x={14}
          y={pad.top + innerH / 2}
          textAnchor="middle"
          className={styles.scoreGapScatterAxisLabel}
          transform={`rotate(-90 14 ${pad.top + innerH / 2})`}
        >
          放置リスク →
        </text>

        {drawOrder.map((p) => {
          const meta = byId.get(p.id);
          if (!meta) return null;
          const { row, rank } = meta;
          return (
            <g key={p.id} style={{ cursor: "pointer" }} onClick={() => onSelect(p.id)}>
              <title>
                {rank}. {row.title}
                {"\n"}放置リスク {row.costOfDelay.toFixed(2)} · 介入 {row.effort.toFixed(2)} · 影響{" "}
                {row.blastRadius.toFixed(2)} · 確信 {row.confidence.toFixed(2)}
                {"\n"}score {row.score.toFixed(2)}
              </title>
              <circle
                cx={p.cx}
                cy={p.cy}
                r={p.r}
                fill={confidenceFill(row.confidence)}
                fillOpacity={0.55 + row.confidence * 0.3}
                stroke="var(--border)"
                strokeWidth={1.25}
              />
              <text x={p.cx} y={p.cy + 3.5} textAnchor="middle" className={styles.scoreGapScatterRank}>
                {rank}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={styles.scoreGapLegend}>
        <span>大＝影響が広い</span>
        <span>色が濃い＝確信度が高い</span>
      </div>
    </div>
  );
}

function ScoreGapsTable({
  rows,
  onSelect,
}: {
  rows: RankedScoreRow[];
  onSelect: (id: string) => void;
}) {
  const maxScore = rows[0]?.score ?? 0;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>タイトル</th>
            <th>優先度</th>
            {TRIAGE_AXIS_META.map((a) => (
              <th key={a.key} title={`${a.label}。${a.hint}`}>
                {a.shortLabel}
              </th>
            ))}
            <th>score</th>
            <th title="ひとつ上の順位とのスコア差（野球のゲーム差に相当）">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const rank = i + 1;
            const priority = (row.priority in ISSUE_PRIORITY_META ? row.priority : "normal") as IssuePriority;
            const delta = deltaFromPrevious(rows, i);
            const gapKind = delta == null ? null : classifyScoreGap(delta, maxScore);
            return (
              <tr key={row.id}>
                <td className={styles.scoreGapTableRank}>{rank}</td>
                <td>
                  <button type="button" className={styles.tableRowLink} onClick={() => onSelect(row.id)}>
                    {row.title}
                  </button>
                </td>
                <td>
                  <IssuePriorityBadge priority={priority} />
                </td>
                <td className={styles.scoreGapNum}>{row.costOfDelay.toFixed(2)}</td>
                <td className={styles.scoreGapNum}>{row.effort.toFixed(2)}</td>
                <td className={styles.scoreGapNum}>{row.blastRadius.toFixed(2)}</td>
                <td className={styles.scoreGapNum}>{row.confidence.toFixed(2)}</td>
                <td className={styles.scoreGapNum}>
                  <strong>{row.score.toFixed(2)}</strong>
                </td>
                <td
                  className={`${styles.scoreGapNum} ${
                    gapKind === "cliff"
                      ? styles.scoreGapDeltaCliff
                      : gapKind === "plateau"
                        ? styles.scoreGapDeltaPlateau
                        : ""
                  }`}
                >
                  {delta == null ? "―" : delta.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 4象限バブルとスコア表で、上位の取り方を補佐する常設ビュー。 */
export function IssueScoreGapsView({
  issues,
  onSelect,
}: {
  issues: Issue[];
  onSelect: (id: string) => void;
}) {
  const { ranked, unscored } = buildRankedRows(issues);
  const gaps = buildGapAnnotations(ranked);
  const summaries = summarizeGaps(ranked, gaps);
  const visible = ranked.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = ranked.length - visible.length;

  if (issues.length === 0) {
    return <p className={styles.tableEmpty}>条件に一致するIssueはありません。</p>;
  }

  if (ranked.length === 0) {
    return (
      <div>
        <p className={styles.subtitle}>
          まだ評価スコアがありません。「評価を一括更新」で4軸を採点すると、差の比較が表示されます。
        </p>
        {unscored.length > 0 && (
          <p className={styles.tableMuted} style={{ marginTop: 8 }}>
            未評価 {unscored.length} 件
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.scoreGapView}>
      <p className={styles.subtitle} style={{ margin: "0 0 10px" }}>
        グラフで位置取りを、下の表でスコアとひとつ上との差（Δ）を見ます。順位の確定ではなく、取り方の目安です。
      </p>

      {summaries.length > 0 && (
        <ul className={styles.scoreGapSummary}>
          {summaries.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <QuadrantBubbleChart rows={visible} onSelect={onSelect} />

      <div style={{ marginTop: 16 }}>
        <div className={styles.fieldCaption}>
          スコア順（表示中 {visible.length} / {ranked.length}）· Δ はひとつ上との差
        </div>
        <ScoreGapsTable rows={visible} onSelect={onSelect} />
        {hiddenCount > 0 && (
          <p className={styles.subtitle} style={{ marginTop: 8 }}>
            ほか {hiddenCount} 件はスコアが低いため省略しています（フィルタで絞ると比較しやすくなります）。
          </p>
        )}
      </div>

      {unscored.length > 0 && (
        <div className={styles.scoreGapUnscored}>
          <div className={styles.fieldCaption}>未評価（{unscored.length}）</div>
          <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none" }}>
            {unscored.slice(0, 8).map((u) => (
              <li key={u.id} style={{ marginBottom: 4 }}>
                <button type="button" className={styles.tableRowLink} onClick={() => onSelect(u.id)}>
                  {u.title}
                </button>
              </li>
            ))}
          </ul>
          {unscored.length > 8 && (
            <p className={styles.subtitle} style={{ margin: "4px 0 0" }}>
              ほか {unscored.length - 8} 件
            </p>
          )}
        </div>
      )}
    </div>
  );
}

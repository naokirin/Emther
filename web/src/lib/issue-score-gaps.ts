// 課題タブ「スコア差」ビュー用。順位そのものではなく、隣との差・取り方の補佐。

export type ScoreGapKind = "cliff" | "plateau" | "normal";

export type RankedScoreRow = {
  id: string;
  title: string;
  priority: string;
  score: number;
  costOfDelay: number;
  effort: number;
  blastRadius: number;
  confidence: number;
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** 隣との差の大きさ。集合内のスケールも見て崖／高原を付ける。 */
export function classifyScoreGap(delta: number, maxScore: number): ScoreGapKind {
  const scale = Math.max(maxScore, 0.2);
  const cliffAt = Math.max(0.12, scale * 0.22);
  const plateauAt = Math.max(0.03, scale * 0.06);
  if (delta >= cliffAt) return "cliff";
  if (delta <= plateauAt) return "plateau";
  return "normal";
}

export function buildRankedRows(
  issues: Array<{
    id: string;
    title: string;
    priority?: string | null;
    triage?: {
      score: number;
      costOfDelay: number;
      effort: number;
      blastRadius: number;
      confidence: number;
    } | null;
  }>,
): { ranked: RankedScoreRow[]; unscored: Array<{ id: string; title: string }> } {
  const ranked: RankedScoreRow[] = [];
  const unscored: Array<{ id: string; title: string }> = [];
  for (const issue of issues) {
    if (!issue.triage) {
      unscored.push({ id: issue.id, title: issue.title });
      continue;
    }
    ranked.push({
      id: issue.id,
      title: issue.title,
      priority: issue.priority ?? "normal",
      score: issue.triage.score,
      costOfDelay: issue.triage.costOfDelay,
      effort: issue.triage.effort,
      blastRadius: issue.triage.blastRadius,
      confidence: issue.triage.confidence,
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ja"));
  return { ranked, unscored };
}

export type GapAnnotation = {
  afterRank: number; // この順位の下（rank → rank+1）
  delta: number;
  kind: ScoreGapKind;
};

export function buildGapAnnotations(ranked: RankedScoreRow[]): GapAnnotation[] {
  if (ranked.length < 2) return [];
  const maxScore = ranked[0]?.score ?? 0;
  const gaps: GapAnnotation[] = [];
  for (let i = 0; i < ranked.length - 1; i++) {
    const delta = ranked[i].score - ranked[i + 1].score;
    gaps.push({
      afterRank: i + 1,
      delta,
      kind: classifyScoreGap(delta, maxScore),
    });
  }
  return gaps;
}

/** 表用: 1位は null（―表示）、2位以降はひとつ上との score 差。 */
export function deltaFromPrevious(ranked: RankedScoreRow[], index: number): number | null {
  if (index <= 0) return null;
  return ranked[index - 1].score - ranked[index].score;
}

/** 影響半径 → バブル半径（描画 px）。 */
export function bubbleRadius(blastRadius: number): number {
  return 6 + clamp01(blastRadius) * 14;
}

/**
 * 中心(0.5)付近の値を外側へ広げる。gamma < 1 ほど中心が空き、端点 0/1 は固定。
 * ヒューリスティック採点で中庸に集まりやすい分布向け。
 */
export function expandFromCenter(value: number, gamma = 0.58): number {
  const v = clamp01(value);
  const t = (v - 0.5) * 2;
  if (t === 0) return 0.5;
  const expanded = Math.sign(t) * Math.pow(Math.abs(t), gamma);
  return 0.5 + expanded / 2;
}

export type BubbleLayoutPoint = {
  id: string;
  rank: number;
  cx: number;
  cy: number;
  r: number;
  /** 変換後の本来位置（ジッター前）。 */
  homeCx: number;
  homeCy: number;
};

/** 中心同士がこの距離未満のときだけ、わずかにずらす（完全分離はしない）。 */
const JITTER_TRIGGER_PX = 10;
/** 本来位置からの最大ずれ。 */
const MAX_NUDGE_PX = 8;

/**
 * 放置リスク(Y) × 介入コスト(X) の位置にバブルを置く。
 * 軸は中心拡散、重なりは小さなジッターのみ（多少の重なりは許容）。
 * Y は上が放置リスク高。X は右が介入コスト低（右上がコスパ最良）。
 */
export function layoutQuadrantBubbles(
  rows: RankedScoreRow[],
  opts: { padLeft: number; padTop: number; innerW: number; innerH: number },
): BubbleLayoutPoint[] {
  const points: BubbleLayoutPoint[] = rows.map((row, i) => {
    // 右＝介入が軽い（1 - effort）。中心拡散は反転後の値にかける。
    const x = expandFromCenter(1 - row.effort);
    const y = expandFromCenter(row.costOfDelay);
    const r = bubbleRadius(row.blastRadius);
    const cx = opts.padLeft + x * opts.innerW;
    const cy = opts.padTop + (1 - y) * opts.innerH;
    return {
      id: row.id,
      rank: i + 1,
      cx,
      cy,
      homeCx: cx,
      homeCy: cy,
      r,
    };
  });

  // ほぼ同じ座標の点だけ、順位由来の小さな螺旋オフセット（本来位置から MAX_NUDGE 以内）
  for (let i = 0; i < points.length; i++) {
    const cluster: number[] = [i];
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const dist = Math.hypot(points[j].homeCx - points[i].homeCx, points[j].homeCy - points[i].homeCy);
      if (dist < JITTER_TRIGGER_PX) cluster.push(j);
    }
    if (cluster.length < 2) continue;
    // 各点について、クラスタ内での順位順インデックスでオフセット（i 自身の処理時のみ自分を動かす）
    const sorted = [...cluster].sort((a, b) => points[a].rank - points[b].rank);
    const idx = sorted.indexOf(i);
    if (idx <= 0) continue; // クラスタ先頭（最上位）はホームに据え置き
    const angle = idx * 2.399963229728653;
    const radius = Math.min(MAX_NUDGE_PX, 3 + idx * 2);
    points[i].cx = points[i].homeCx + Math.cos(angle) * radius;
    points[i].cy = points[i].homeCy + Math.sin(angle) * radius;
  }

  // バブル全体がプロット枠内に収まるよう半径込みでクランプ（枠外の象限ラベルと重ならない）
  for (const p of points) {
    const minX = opts.padLeft + p.r;
    const maxX = opts.padLeft + opts.innerW - p.r;
    const minY = opts.padTop + p.r;
    const maxY = opts.padTop + opts.innerH - p.r;
    p.cx = Math.max(minX, Math.min(maxX, p.cx));
    p.cy = Math.max(minY, Math.min(maxY, p.cy));
  }

  return points;
}

/** 上位が重く、その下に軽い中スコアがあるときの振替ヒント。 */
export function detectHeavyTopSwapHint(ranked: RankedScoreRow[], topN = 3): string | null {
  if (ranked.length < 3) return null;
  const top = ranked.slice(0, Math.min(topN, ranked.length));
  const rest = ranked.slice(Math.min(topN, ranked.length), Math.min(topN + 4, ranked.length));
  if (rest.length === 0) return null;

  const topHeavy = top.filter((r) => r.effort >= 0.6);
  if (topHeavy.length === 0) return null;

  const lightAlt = rest.find((r) => r.effort <= 0.45 && r.score >= top[top.length - 1].score * 0.55);
  if (!lightAlt) return null;

  const heavyTitles = topHeavy.map((r) => r.title).slice(0, 2);
  return `上位は介入コストが高め（${heavyTitles.join("、")}）。軽い次点「${lightAlt.title}」へ振る選択肢もあります`;
}

export function summarizeGaps(ranked: RankedScoreRow[], gaps: GapAnnotation[]): string[] {
  const lines: string[] = [];
  if (ranked.length === 0) return lines;
  if (ranked.length === 1) {
    lines.push("評価済みは1件だけです。差の比較対象がまだありません");
    return lines;
  }

  const firstCliff = gaps.find((g) => g.kind === "cliff");
  if (firstCliff && firstCliff.afterRank === 1) {
    lines.push(
      `1位が突出しています（2位との差 ${firstCliff.delta.toFixed(2)}）。まず1件に集中する向きです`,
    );
  } else if (firstCliff) {
    lines.push(
      `${firstCliff.afterRank}位の下で一段落ちます（差 ${firstCliff.delta.toFixed(2)}）。ここより下は余裕があれば、の候補です`,
    );
  }

  const plateauRun = gaps.filter((g) => g.kind === "plateau");
  if (plateauRun.length >= 2 || (plateauRun.length === 1 && !firstCliff)) {
    const from = plateauRun[0].afterRank;
    const to = plateauRun[plateauRun.length - 1].afterRank + 1;
    lines.push(`${from}〜${to}位はほぼ同点帯です。容量で切るか並列で配分する向きです`);
  }

  const swap = detectHeavyTopSwapHint(ranked);
  if (swap) lines.push(swap);

  if (lines.length === 0) {
    lines.push("上位の差はなだらかです。帯（フォーカス／通常）と介入コストを見て配分してください");
  }
  return lines;
}

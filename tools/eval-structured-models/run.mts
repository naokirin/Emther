/**
 * Emther Phase1/2 軽量検証:
 * - Phase1: MiniLM cosine (baseline) vs Japanese tiny reranker (optional bge)
 * - Phase2: mDeBERTa zero-shot for urgency / recommendation / theme-link
 *
 * 製品コードには接続しない。フィクスチャのみでオフライン評価。
 *
 * 実行:
 *   pnpm exec tsx tools/eval-structured-models/run.mts
 *   pnpm exec tsx tools/eval-structured-models/run.mts --skip-rerank
 *   pnpm exec tsx tools/eval-structured-models/run.mts --with-bge
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  pipeline,
  type ProgressCallback,
} from "@huggingface/transformers";
import { cosineSimilarity, embedText, getEmbedder } from "../../packages/core/src/embeddings.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "fixtures.json");
const OUT_DIR = join(__dirname, "out");

const BASELINE_THRESHOLD = 0.4;
const RERANK_CANDIDATES = 20;
const TOP_K = 5;

const RERANKER_TINY = "hotchpotch/japanese-reranker-tiny-v2";
const RERANKER_BGE = "onnx-community/bge-reranker-v2-m3-ONNX";
const ZEROSHOT_MODEL = "Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7";

type Pair = { id: string; label: "related" | "unrelated"; a: string; b: string };
type CorpusItem = { id: string; text: string };
type Query = { id: string; text: string; relevantIds: string[] };
type LabeledText = { id: string; text: string; label: string };
type ThemeLink = { id: string; suggestion: string; theme: string; label: "link" | "no_link" };

type Fixtures = {
  pairs: Pair[];
  search: { corpus: CorpusItem[]; queries: Query[] };
  urgency: LabeledText[];
  recommendation: LabeledText[];
  themeLink: ThemeLink[];
};

type Ranked = { id: string; score: number };

const args = new Set(process.argv.slice(2));
const skipRerank = args.has("--skip-rerank");
const withBge = args.has("--with-bge");
const skipPhase2 = args.has("--skip-phase2");
const skipPhase1 = args.has("--skip-phase1");
const phase2Variant = args.has("--phase2-en") ? "en" : "ja";

function progress(label: string): ProgressCallback {
  let last = "";
  return (info) => {
    const status = String(info.status ?? "");
    const file = String((info as { file?: string }).file ?? "");
    const key = `${status}:${file}`;
    if (key === last) return;
    last = key;
    if (status === "progress" || status === "done") return;
    console.error(`[${label}] ${status}${file ? ` ${file}` : ""}`);
  };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function spearman(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const rank = (xs: number[]) => {
    const sorted = xs.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
    const ranks = new Array(n);
    for (let r = 0; r < n; r++) ranks[sorted[r].i] = r + 1;
    return ranks as number[];
  };
  const ra = rank(a);
  const rb = rank(b);
  let num = 0;
  let da = 0;
  let db = 0;
  const ma = mean(ra);
  const mb = mean(rb);
  for (let i = 0; i < n; i++) {
    const xa = ra[i] - ma;
    const xb = rb[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function confusionMetrics(yTrue: string[], yPred: string[], labels: string[]) {
  const correct = yTrue.filter((t, i) => t === yPred[i]).length;
  const accuracy = yTrue.length === 0 ? 0 : correct / yTrue.length;
  const perLabel: Record<string, { precision: number; recall: number; f1: number; support: number }> = {};
  const f1s: number[] = [];
  for (const lab of labels) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < yTrue.length; i++) {
      if (yPred[i] === lab && yTrue[i] === lab) tp++;
      else if (yPred[i] === lab && yTrue[i] !== lab) fp++;
      else if (yPred[i] !== lab && yTrue[i] === lab) fn++;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perLabel[lab] = { precision, recall, f1, support: yTrue.filter((t) => t === lab).length };
    f1s.push(f1);
  }
  return { accuracy, macroF1: mean(f1s), perLabel };
}

async function embedAll(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) out.push(await embedText(t));
  return out;
}

type Reranker = {
  id: string;
  score: (query: string, docs: string[]) => Promise<number[]>;
  dispose?: () => void;
};

async function loadReranker(modelId: string, dtype: "q8" | "fp32" = "q8"): Promise<Reranker> {
  console.error(`Loading reranker: ${modelId} (${dtype})`);
  const tokenizer = await AutoTokenizer.from_pretrained(modelId, {
    progress_callback: progress(`tok:${modelId}`),
  });
  const model = await AutoModelForSequenceClassification.from_pretrained(modelId, {
    dtype,
    progress_callback: progress(`mdl:${modelId}`),
  });

  return {
    id: modelId,
    async score(query, docs) {
      if (docs.length === 0) return [];
      const inputs = tokenizer(
        docs.map(() => query),
        { text_pair: docs, padding: true, truncation: true },
      );
      const { logits } = await model(inputs);
      const data = logits?.data ?? logits;
      const arr = Array.from(data as Float32Array | number[]);
      // Single logit per pair, or 2-class [neg, pos]
      if (arr.length === docs.length) return arr;
      if (arr.length === docs.length * 2) {
        const scores: number[] = [];
        for (let i = 0; i < docs.length; i++) {
          const neg = arr[i * 2];
          const pos = arr[i * 2 + 1];
          scores.push(pos - neg);
        }
        return scores;
      }
      // Unexpected shape: take every last dim
      const per = Math.floor(arr.length / docs.length);
      return docs.map((_, i) => arr[i * per + (per - 1)]);
    },
  };
}

async function tryLoadRerankers(): Promise<Reranker[]> {
  const loaded: Reranker[] = [];
  if (skipRerank) return loaded;

  const candidates: Array<{ id: string; dtype: "q8" | "fp32" }> = [
    { id: RERANKER_TINY, dtype: "q8" },
    { id: RERANKER_TINY, dtype: "fp32" },
  ];
  if (withBge) candidates.push({ id: RERANKER_BGE, dtype: "q8" });

  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.id) && loaded.some((r) => r.id === c.id)) continue;
    try {
      const r = await loadReranker(c.id, c.dtype);
      loaded.push(r);
      seen.add(c.id);
      console.error(`Reranker ready: ${c.id} dtype=${c.dtype}`);
      break; // one tiny is enough; bge only if --with-bge and tiny failed path handled below
    } catch (err) {
      console.error(`Failed ${c.id} (${c.dtype}): ${(err as Error).message}`);
    }
  }

  // If tiny failed entirely and --with-bge, try bge even if we already attempted in loop
  if (loaded.length === 0 && withBge) {
    try {
      loaded.push(await loadReranker(RERANKER_BGE, "q8"));
    } catch (err) {
      console.error(`BGE also failed: ${(err as Error).message}`);
    }
  }

  // Explicit second pass for bge when tiny succeeded and --with-bge
  if (withBge && loaded.every((r) => r.id !== RERANKER_BGE)) {
    try {
      loaded.push(await loadReranker(RERANKER_BGE, "q8"));
      console.error("Reranker ready: bge");
    } catch (err) {
      console.error(`BGE failed: ${(err as Error).message}`);
    }
  }

  return loaded;
}

function bestThresholdAccuracy(
  scores: number[],
  labels: Array<"related" | "unrelated">,
): { threshold: number; accuracy: number } {
  const uniq = [...new Set(scores)].sort((a, b) => a - b);
  const candidates = [-Infinity, ...uniq.map((s, i) => (i === 0 ? s - 1e-6 : (uniq[i - 1] + s) / 2)), Infinity];
  let best = { threshold: 0, accuracy: -1 };
  for (const thr of candidates) {
    let ok = 0;
    for (let i = 0; i < scores.length; i++) {
      const pred = scores[i] >= thr ? "related" : "unrelated";
      if (pred === labels[i]) ok++;
    }
    const accuracy = ok / scores.length;
    if (accuracy > best.accuracy) best = { threshold: thr, accuracy };
  }
  return best;
}

async function evalPairsCosine(pairs: Pair[]) {
  const t0 = Date.now();
  const scores: number[] = [];
  for (const p of pairs) {
    const [ea, eb] = await Promise.all([embedText(p.a), embedText(p.b)]);
    scores.push(cosineSimilarity(ea, eb));
  }
  const labels = pairs.map((p) => p.label);
  const at04 = labels.map((lab, i) => {
    const pred = scores[i] >= BASELINE_THRESHOLD ? "related" : "unrelated";
    return pred === lab;
  });
  const gap =
    mean(scores.filter((_, i) => labels[i] === "related")) -
    mean(scores.filter((_, i) => labels[i] === "unrelated"));
  const best = bestThresholdAccuracy(scores, labels);
  return {
    method: "cosine",
    ms: Date.now() - t0,
    threshold04Accuracy: at04.filter(Boolean).length / pairs.length,
    bestThreshold: best.threshold,
    bestAccuracy: best.accuracy,
    relatedMean: mean(scores.filter((_, i) => labels[i] === "related")),
    unrelatedMean: mean(scores.filter((_, i) => labels[i] === "unrelated")),
    gap,
    scores: pairs.map((p, i) => ({ id: p.id, label: p.label, score: scores[i] })),
  };
}

async function evalPairsRerank(pairs: Pair[], reranker: Reranker) {
  const t0 = Date.now();
  const scores: number[] = [];
  for (const p of pairs) {
    const [s] = await reranker.score(p.a, [p.b]);
    scores.push(s);
  }
  const labels = pairs.map((p) => p.label);
  const best = bestThresholdAccuracy(scores, labels);
  const gap =
    mean(scores.filter((_, i) => labels[i] === "related")) -
    mean(scores.filter((_, i) => labels[i] === "unrelated"));
  return {
    method: `rerank:${reranker.id}`,
    ms: Date.now() - t0,
    bestThreshold: best.threshold,
    bestAccuracy: best.accuracy,
    relatedMean: mean(scores.filter((_, i) => labels[i] === "related")),
    unrelatedMean: mean(scores.filter((_, i) => labels[i] === "unrelated")),
    gap,
    scores: pairs.map((p, i) => ({ id: p.id, label: p.label, score: scores[i] })),
  };
}

async function evalSearchCosine(fixtures: Fixtures) {
  const { corpus, queries } = fixtures.search;
  const t0 = Date.now();
  const corpusEmb = await embedAll(corpus.map((c) => c.text));
  const recalls: number[] = [];
  const mrrs: number[] = [];
  const details = [];

  for (const q of queries) {
    const qe = await embedText(q.text);
    const ranked: Ranked[] = corpus
      .map((c, i) => ({ id: c.id, score: cosineSimilarity(qe, corpusEmb[i]) }))
      .sort((a, b) => b.score - a.score);
    const top = ranked.slice(0, TOP_K);
    const hit = q.relevantIds.some((id) => top.some((t) => t.id === id));
    recalls.push(hit ? 1 : 0);
    let rr = 0;
    for (let i = 0; i < ranked.length; i++) {
      if (q.relevantIds.includes(ranked[i].id)) {
        rr = 1 / (i + 1);
        break;
      }
    }
    mrrs.push(rr);
    details.push({
      queryId: q.id,
      topIds: top.map((t) => t.id),
      topScores: top.map((t) => t.score),
      hitAt5: hit,
      mrr: rr,
    });
  }

  return {
    method: "cosine",
    ms: Date.now() - t0,
    recallAt5: mean(recalls),
    mrr: mean(mrrs),
    details,
  };
}

async function evalSearchRerank(fixtures: Fixtures, reranker: Reranker) {
  const { corpus, queries } = fixtures.search;
  const t0 = Date.now();
  const corpusEmb = await embedAll(corpus.map((c) => c.text));
  const recalls: number[] = [];
  const mrrs: number[] = [];
  const jaccards: number[] = [];
  const details = [];

  for (const q of queries) {
    const qe = await embedText(q.text);
    const coarse = corpus
      .map((c, i) => ({ id: c.id, text: c.text, score: cosineSimilarity(qe, corpusEmb[i]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(RERANK_CANDIDATES, corpus.length));

    const rrScores = await reranker.score(
      q.text,
      coarse.map((c) => c.text),
    );
    const ranked = coarse
      .map((c, i) => ({ id: c.id, score: rrScores[i] }))
      .sort((a, b) => b.score - a.score);
    const top = ranked.slice(0, TOP_K);
    const baselineTop = coarse.slice(0, TOP_K).map((c) => c.id);
    const hit = q.relevantIds.some((id) => top.some((t) => t.id === id));
    recalls.push(hit ? 1 : 0);
    let rr = 0;
    for (let i = 0; i < ranked.length; i++) {
      if (q.relevantIds.includes(ranked[i].id)) {
        rr = 1 / (i + 1);
        break;
      }
    }
    mrrs.push(rr);
    jaccards.push(jaccard(baselineTop, top.map((t) => t.id)));
    details.push({
      queryId: q.id,
      topIds: top.map((t) => t.id),
      topScores: top.map((t) => t.score),
      baselineTopIds: baselineTop,
      hitAt5: hit,
      mrr: rr,
    });
  }

  return {
    method: `rerank:${reranker.id}`,
    ms: Date.now() - t0,
    recallAt5: mean(recalls),
    mrr: mean(mrrs),
    top5JaccardVsCosine: mean(jaccards),
    details,
  };
}

type ZeroShot = Awaited<ReturnType<typeof pipeline<"zero-shot-classification">>>;

async function loadZeroShot(): Promise<ZeroShot> {
  console.error(`Loading zero-shot: ${ZEROSHOT_MODEL}`);
  return pipeline("zero-shot-classification", ZEROSHOT_MODEL, {
    dtype: "q8",
    progress_callback: progress("zeroshot"),
  });
}

async function classifyFixed(
  clf: ZeroShot,
  texts: string[],
  labels: string[],
  hypothesisTemplate: string,
) {
  const preds: string[] = [];
  const scores: Array<Record<string, number>> = [];
  const t0 = Date.now();
  for (const text of texts) {
    const out = await clf(text, labels, { hypothesis_template: hypothesisTemplate, multi_label: false });
    // transformers.js returns { labels, scores } or array
    const result = Array.isArray(out) ? out[0] : out;
    const labs = (result as { labels: string[] }).labels;
    const sc = (result as { scores: number[] }).scores;
    const map: Record<string, number> = {};
    for (let i = 0; i < labs.length; i++) map[labs[i]] = sc[i];
    scores.push(map);
    preds.push(labs[0]);
  }
  return { preds, scores, ms: Date.now() - t0 };
}

async function evalUrgency(clf: ZeroShot, items: LabeledText[], variant: "ja" | "en") {
  const labels = ["high", "mid", "low"];
  const template =
    variant === "en" ? "The urgency of this note is {}." : "この記録の緊急度は「{}」である。";
  const { preds, scores, ms } = await classifyFixed(
    clf,
    items.map((i) => i.text),
    labels,
    template,
  );
  const metrics = confusionMetrics(
    items.map((i) => i.label),
    preds,
    labels,
  );
  return {
    task: "urgency",
    variant,
    hypothesisTemplate: template,
    ms,
    ...metrics,
    samples: items.map((i, idx) => ({
      id: i.id,
      gold: i.label,
      pred: preds[idx],
      scores: scores[idx],
    })),
  };
}

async function evalRecommendation(clf: ZeroShot, items: LabeledText[], variant: "ja" | "en") {
  const labelMap: Record<string, string> =
    variant === "en"
      ? {
          "create an intervention suggestion": "suggestion",
          "watch and gather more signal": "watch",
          dismiss: "dismiss",
        }
      : {
          介入を起票すべき: "suggestion",
          様子見でよい: "watch",
          今は却下してよい: "dismiss",
        };
  const surfaceLabels = Object.keys(labelMap);
  const template =
    variant === "en"
      ? "The right next action for an engineering manager is to {}."
      : "エンジニアリングマネージャーとして取るべき対応は「{}」である。";
  const { preds: surfacePreds, scores: surfaceScores, ms } = await classifyFixed(
    clf,
    items.map((i) => i.text),
    surfaceLabels,
    template,
  );
  const preds = surfacePreds.map((p) => labelMap[p] ?? p);
  const scores = surfaceScores.map((s) => {
    const out: Record<string, number> = {};
    for (const [surface, en] of Object.entries(labelMap)) out[en] = s[surface] ?? 0;
    return out;
  });
  const labels = ["suggestion", "watch", "dismiss"];
  const metrics = confusionMetrics(
    items.map((i) => i.label),
    preds,
    labels,
  );
  return {
    task: "recommendation",
    variant,
    hypothesisTemplate: template,
    ms,
    ...metrics,
    samples: items.map((i, idx) => ({
      id: i.id,
      gold: i.label,
      pred: preds[idx],
      scores: scores[idx],
    })),
  };
}

async function evalThemeLinkZeroShot(clf: ZeroShot, items: ThemeLink[], variant: "ja" | "en") {
  const labelMap: Record<string, "link" | "no_link"> =
    variant === "en"
      ? { related: "link", unrelated: "no_link" }
      : { 関連している: "link", 無関係である: "no_link" };
  const surfaceLabels = Object.keys(labelMap);
  const template =
    variant === "en"
      ? "The suggestion and the theme are {}."
      : "この提案とテーマの関係は「{}」。";
  const texts = items.map((i) =>
    variant === "en"
      ? `Suggestion: ${i.suggestion}\nTheme: ${i.theme}`
      : `提案: ${i.suggestion}\nテーマ: ${i.theme}`,
  );
  const { preds: surfacePreds, scores: surfaceScores, ms } = await classifyFixed(
    clf,
    texts,
    surfaceLabels,
    template,
  );
  const preds = surfacePreds.map((p) => labelMap[p] ?? "no_link");
  const scores = surfaceScores.map((s) => {
    const out: Record<string, number> = { link: 0, no_link: 0 };
    for (const [surface, en] of Object.entries(labelMap)) out[en] = s[surface] ?? 0;
    return out;
  });
  const metrics = confusionMetrics(
    items.map((i) => i.label),
    preds,
    ["link", "no_link"],
  );
  return {
    task: "themeLinkZeroShot",
    variant,
    hypothesisTemplate: template,
    ms,
    ...metrics,
    samples: items.map((i, idx) => ({
      id: i.id,
      gold: i.label,
      pred: preds[idx],
      scores: scores[idx],
    })),
  };
}

/** Theme link via pairwise score (Phase1系) — zero-shot より本命寄りの比較用。 */
async function evalThemeLinkScored(
  items: ThemeLink[],
  scorePair: (suggestion: string, theme: string) => Promise<number>,
  method: string,
) {
  const t0 = Date.now();
  const raw: number[] = [];
  for (const i of items) raw.push(await scorePair(i.suggestion, i.theme));
  const labels = items.map((i) => i.label);
  // Treat higher score as link; sweep threshold for best accuracy / link precision
  const uniq = [...new Set(raw)].sort((a, b) => a - b);
  const candidates = [
    -Infinity,
    ...uniq.map((s, i) => (i === 0 ? s - 1e-6 : (uniq[i - 1] + s) / 2)),
    Infinity,
  ];
  let best = {
    threshold: 0,
    accuracy: -1,
    linkPrecision: 0,
    linkRecall: 0,
    preds: labels.map(() => "no_link" as "link" | "no_link"),
  };
  for (const thr of candidates) {
    const preds = raw.map((s) => (s >= thr ? "link" : "no_link")) as Array<"link" | "no_link">;
    const metrics = confusionMetrics(labels, preds, ["link", "no_link"]);
    const linkPrecision = metrics.perLabel.link.precision;
    const linkRecall = metrics.perLabel.link.recall;
    // Prefer accuracy; break ties by link precision (false links are costly for HITL)
    if (
      metrics.accuracy > best.accuracy ||
      (metrics.accuracy === best.accuracy && linkPrecision > best.linkPrecision)
    ) {
      best = {
        threshold: thr,
        accuracy: metrics.accuracy,
        linkPrecision,
        linkRecall,
        preds,
      };
    }
  }
  const metrics = confusionMetrics(labels, best.preds, ["link", "no_link"]);
  return {
    task: "themeLinkScored",
    method,
    ms: Date.now() - t0,
    bestThreshold: best.threshold,
    ...metrics,
    samples: items.map((i, idx) => ({
      id: i.id,
      gold: i.label,
      pred: best.preds[idx],
      score: raw[idx],
    })),
  };
}

function printSection(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as Fixtures;
  mkdirSync(OUT_DIR, { recursive: true });

  console.error("Warming embedder...");
  await getEmbedder(progress("embed"));
  await embedText("warmup");

  const report: Record<string, unknown> = {
    ranAt: new Date().toISOString(),
    args: { skipRerank, withBge, skipPhase1, skipPhase2, phase2Variant },
    phase1: {} as Record<string, unknown>,
    phase2: {} as Record<string, unknown>,
  };

  let pairCosine: Awaited<ReturnType<typeof evalPairsCosine>> | null = null;
  let searchCosine: Awaited<ReturnType<typeof evalSearchCosine>> | null = null;
  const pairRerankResults: Awaited<ReturnType<typeof evalPairsRerank>>[] = [];
  const searchRerankResults: Array<
    Awaited<ReturnType<typeof evalSearchRerank>> & { recallDelta: number; mrrDelta: number }
  > = [];
  let primaryReranker: Reranker | null = null;

  if (!skipPhase1) {
    printSection("Phase1 pairs (cosine)");
    pairCosine = await evalPairsCosine(fixtures.pairs);
    console.log(
      JSON.stringify(
        {
          threshold04Accuracy: pairCosine.threshold04Accuracy,
          bestAccuracy: pairCosine.bestAccuracy,
          bestThreshold: pairCosine.bestThreshold,
          gap: pairCosine.gap,
          relatedMean: pairCosine.relatedMean,
          unrelatedMean: pairCosine.unrelatedMean,
          ms: pairCosine.ms,
        },
        null,
        2,
      ),
    );
    (report.phase1 as Record<string, unknown>).pairsCosine = pairCosine;

    printSection("Phase1 search (cosine)");
    searchCosine = await evalSearchCosine(fixtures);
    console.log(
      JSON.stringify(
        { recallAt5: searchCosine.recallAt5, mrr: searchCosine.mrr, ms: searchCosine.ms },
        null,
        2,
      ),
    );
    (report.phase1 as Record<string, unknown>).searchCosine = searchCosine;

    const rerankers = await tryLoadRerankers();
    primaryReranker = rerankers[0] ?? null;
    for (const r of rerankers) {
      printSection(`Phase1 pairs (rerank ${r.id})`);
      const pr = await evalPairsRerank(fixtures.pairs, r);
      console.log(
        JSON.stringify(
          {
            bestAccuracy: pr.bestAccuracy,
            bestThreshold: pr.bestThreshold,
            gap: pr.gap,
            relatedMean: pr.relatedMean,
            unrelatedMean: pr.unrelatedMean,
            ms: pr.ms,
          },
          null,
          2,
        ),
      );
      pairRerankResults.push(pr);

      printSection(`Phase1 search (rerank ${r.id})`);
      const sr = await evalSearchRerank(fixtures, r);
      const recallDelta = sr.recallAt5 - searchCosine.recallAt5;
      const mrrDelta = sr.mrr - searchCosine.mrr;
      console.log(
        JSON.stringify(
          {
            recallAt5: sr.recallAt5,
            mrr: sr.mrr,
            recallDelta,
            mrrDelta,
            top5JaccardVsCosine: sr.top5JaccardVsCosine,
            ms: sr.ms,
          },
          null,
          2,
        ),
      );
      searchRerankResults.push({ ...sr, recallDelta, mrrDelta });
    }
    (report.phase1 as Record<string, unknown>).pairsRerank = pairRerankResults;
    (report.phase1 as Record<string, unknown>).searchRerank = searchRerankResults;
    if (rerankers.length === 0) {
      console.error("No reranker loaded — Phase1 rerank skipped (cosine baseline only).");
    }

    if (pairRerankResults.length > 0 && pairCosine) {
      const cosScores = pairCosine.scores.map((s) => s.score);
      const rrScores = pairRerankResults[0].scores.map((s) => s.score);
      const corr = spearman(cosScores, rrScores);
      (report.phase1 as Record<string, unknown>).pairScoreSpearmanCosineVsRerank = corr;
      console.log(`\nSpearman(cosine, rerank) on pairs: ${corr.toFixed(3)}`);
    }
  } else {
    console.error("Skipping Phase1 (--skip-phase1)");
  }

  if (!skipPhase2) {
    const clf = await loadZeroShot();

    printSection(`Phase2 urgency (${phase2Variant})`);
    const urg = await evalUrgency(clf, fixtures.urgency, phase2Variant);
    console.log(
      JSON.stringify(
        { accuracy: urg.accuracy, macroF1: urg.macroF1, perLabel: urg.perLabel, ms: urg.ms },
        null,
        2,
      ),
    );
    (report.phase2 as Record<string, unknown>).urgency = urg;

    printSection(`Phase2 recommendation (${phase2Variant})`);
    const rec = await evalRecommendation(clf, fixtures.recommendation, phase2Variant);
    console.log(
      JSON.stringify(
        { accuracy: rec.accuracy, macroF1: rec.macroF1, perLabel: rec.perLabel, ms: rec.ms },
        null,
        2,
      ),
    );
    (report.phase2 as Record<string, unknown>).recommendation = rec;

    printSection(`Phase2 themeLink zero-shot (${phase2Variant})`);
    const tlZs = await evalThemeLinkZeroShot(clf, fixtures.themeLink, phase2Variant);
    console.log(
      JSON.stringify(
        {
          accuracy: tlZs.accuracy,
          macroF1: tlZs.macroF1,
          perLabel: tlZs.perLabel,
          ms: tlZs.ms,
        },
        null,
        2,
      ),
    );
    (report.phase2 as Record<string, unknown>).themeLinkZeroShot = tlZs;

    // Theme link via cosine / rerank (more appropriate for linking)
    printSection("Phase2 themeLink scored (cosine)");
    const tlCos = await evalThemeLinkScored(
      fixtures.themeLink,
      async (suggestion, theme) => {
        const [e1, e2] = await Promise.all([embedText(suggestion), embedText(theme)]);
        return cosineSimilarity(e1, e2);
      },
      "cosine",
    );
    console.log(
      JSON.stringify(
        {
          accuracy: tlCos.accuracy,
          macroF1: tlCos.macroF1,
          perLabel: tlCos.perLabel,
          bestThreshold: tlCos.bestThreshold,
          ms: tlCos.ms,
        },
        null,
        2,
      ),
    );
    (report.phase2 as Record<string, unknown>).themeLinkCosine = tlCos;

    if (!primaryReranker && !skipRerank) {
      const loaded = await tryLoadRerankers();
      primaryReranker = loaded[0] ?? null;
    }
    if (primaryReranker) {
      printSection(`Phase2 themeLink scored (rerank ${primaryReranker.id})`);
      const rr = primaryReranker;
      const tlRr = await evalThemeLinkScored(
        fixtures.themeLink,
        async (suggestion, theme) => {
          const [s] = await rr.score(suggestion, [theme]);
          return s;
        },
        `rerank:${rr.id}`,
      );
      console.log(
        JSON.stringify(
          {
            accuracy: tlRr.accuracy,
            macroF1: tlRr.macroF1,
            perLabel: tlRr.perLabel,
            bestThreshold: tlRr.bestThreshold,
            ms: tlRr.ms,
          },
          null,
          2,
        ),
      );
      (report.phase2 as Record<string, unknown>).themeLinkRerank = tlRr;
    }
  }

  // Go/No-Go summary
  printSection("Go/No-Go checklist");
  const go: Record<string, string> = {};
  if (searchRerankResults.length > 0 && searchCosine && pairCosine) {
    const best = searchRerankResults.reduce((a, b) => (b.mrr >= a.mrr ? b : a));
    const pairBest = pairRerankResults.reduce((a, b) => (b.bestAccuracy >= a.bestAccuracy ? b : a));
    const recallCeiled = searchCosine.recallAt5 >= 0.999;
    if (best.recallDelta >= 0.1) go.phase1_search = "GO (recall +0.1+)";
    else if (recallCeiled && best.mrrDelta > 0.05) go.phase1_search = "GO (recall ceiling; MRR improved)";
    else if (best.mrrDelta > 0 || best.recallDelta > 0) go.phase1_search = "WEAK GO (ranking improved)";
    else if (pairBest.bestAccuracy >= pairCosine.bestAccuracy && pairBest.gap > pairCosine.gap)
      go.phase1_search = "WEAK GO (pair separation only)";
    else go.phase1_search = "NO-GO / revisit";
    go.phase1_pair_acc = `cosine best=${pairCosine.bestAccuracy.toFixed(2)} gap=${pairCosine.gap.toFixed(3)} / rerank best=${pairBest.bestAccuracy.toFixed(2)} gap=${pairBest.gap.toFixed(3)}`;
    go.phase1_mrr = `cosine=${searchCosine.mrr.toFixed(3)} → rerank=${best.mrr.toFixed(3)} (Δ${best.mrrDelta.toFixed(3)})`;
  } else if (!skipPhase1) {
    go.phase1 = "SKIPPED rerank — cosine baseline only recorded";
  }

  const p2 = report.phase2 as {
    urgency?: { accuracy: number };
    recommendation?: { accuracy: number };
    themeLinkZeroShot?: { accuracy: number; perLabel: Record<string, { precision: number }> };
    themeLinkCosine?: { accuracy: number; perLabel: Record<string, { precision: number }> };
    themeLinkRerank?: { accuracy: number; perLabel: Record<string, { precision: number }> };
  };
  if (p2.urgency) {
    go.phase2_urgency = p2.urgency.accuracy >= 0.7 ? "GO" : p2.urgency.accuracy >= 0.55 ? "WEAK" : "NO-GO";
    go.phase2_urgency_acc = p2.urgency.accuracy.toFixed(3);
  }
  if (p2.recommendation) {
    go.phase2_recommendation =
      p2.recommendation.accuracy >= 0.65 ? "GO" : p2.recommendation.accuracy >= 0.45 ? "WEAK" : "NO-GO";
    go.phase2_recommendation_acc = p2.recommendation.accuracy.toFixed(3);
  }
  if (p2.themeLinkZeroShot) {
    const linkP = p2.themeLinkZeroShot.perLabel.link?.precision ?? 0;
    go.phase2_themeLink_zeroshot =
      linkP >= 0.8 && p2.themeLinkZeroShot.accuracy >= 0.7
        ? "GO"
        : linkP >= 0.65
          ? "WEAK"
          : "NO-GO";
    go.phase2_themeLink_zeroshot_detail = `acc=${p2.themeLinkZeroShot.accuracy.toFixed(3)} linkP=${linkP.toFixed(3)}`;
  }
  if (p2.themeLinkCosine) {
    const linkP = p2.themeLinkCosine.perLabel.link?.precision ?? 0;
    go.phase2_themeLink_cosine =
      linkP >= 0.8 && p2.themeLinkCosine.accuracy >= 0.7
        ? "GO"
        : linkP >= 0.65 || p2.themeLinkCosine.accuracy >= 0.75
          ? "WEAK"
          : "NO-GO";
    go.phase2_themeLink_cosine_detail = `acc=${p2.themeLinkCosine.accuracy.toFixed(3)} linkP=${linkP.toFixed(3)}`;
  }
  if (p2.themeLinkRerank) {
    const linkP = p2.themeLinkRerank.perLabel.link?.precision ?? 0;
    go.phase2_themeLink_rerank =
      linkP >= 0.8 && p2.themeLinkRerank.accuracy >= 0.7
        ? "GO"
        : linkP >= 0.65 || p2.themeLinkRerank.accuracy >= 0.75
          ? "WEAK"
          : "NO-GO";
    go.phase2_themeLink_rerank_detail = `acc=${p2.themeLinkRerank.accuracy.toFixed(3)} linkP=${linkP.toFixed(3)}`;
  }
  report.goNoGo = go;
  console.log(JSON.stringify(go, null, 2));

  const outPath = join(OUT_DIR, `report-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.error(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

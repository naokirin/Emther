#!/usr/bin/env node
/**
 * Emther detectNameCandidates vs gold (rule-only, no people-directory filter).
 * Run from repo: node --import tsx tools/privacy_check_bench/run_emther.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "../../packages/core/src/test-helpers/store-env.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(ROOT, "fixtures");

const HONORIFIC_RE = /(さん|くん|ちゃん|様|氏)$/;

function normalize(name: string): string {
  return name.trim().replace(HONORIFIC_RE, "");
}

function score(pred: string[], gold: string[]) {
  const predN = new Set(pred.map(normalize).filter(Boolean));
  const goldN = new Set(gold.map(normalize).filter(Boolean));
  const tp = [...predN].filter((x) => goldN.has(x)).sort();
  const fp = [...predN].filter((x) => !goldN.has(x)).sort();
  const fn = [...goldN].filter((x) => !predN.has(x)).sort();
  const precision = predN.size ? tp.length / predN.size : 0;
  const recall = goldN.size ? tp.length / goldN.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    tp,
    fp,
    fn,
    pred_raw: pred,
  };
}

const dir = setupIsolatedStoreEnv();
try {
  const { detectNameCandidates, detectSensitiveByRules } = await import("../../packages/core/src/mask-check.ts");
  const gold = JSON.parse(readFileSync(join(FIXTURES, "gold.json"), "utf8"));
  const results: Record<string, unknown> = { engine: "emther/detectNameCandidates+rules", samples: {} };

  for (const [key, meta] of Object.entries(gold.samples) as [string, { file: string; gold_names: string[] }][]) {
    const text = readFileSync(join(FIXTURES, meta.file), "utf8");
    const pred = detectNameCandidates(text);
    const findings = detectSensitiveByRules(text).map((f) => ({
      category: f.category,
      match: f.match,
    }));
    const s = score(pred, meta.gold_names);
    (results.samples as Record<string, unknown>)[key] = { ...s, sensitive_matches: findings };
    console.log(`\n== ${key} ==`);
    console.log(`pred: ${JSON.stringify(pred)}`);
    console.log(`P/R/F1: ${s.precision}/${s.recall}/${s.f1}`);
    console.log(`FP: ${JSON.stringify(s.fp)}  FN: ${JSON.stringify(s.fn)}`);
    console.log(`sensitive: ${JSON.stringify(findings.map((f) => f.match))}`);
  }

  const outPath = join(ROOT, "out_emther.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.error(`\nWrote ${outPath}`);
} finally {
  teardownIsolatedStoreEnv(dir);
}

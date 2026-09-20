#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "../../packages/core/src/test-helpers/store-env.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(ROOT, "fixtures");

type KeywordRule = { category: string; phrases: string[] };

function findPhrases(text: string, rules: KeywordRule[]) {
  const out: { category: string; match: string }[] = [];
  for (const rule of rules) {
    for (const phrase of rule.phrases) {
      const ascii = /[A-Za-z]/.test(phrase);
      const searchIn = ascii ? text.toLowerCase() : text;
      const p = ascii ? phrase.toLowerCase() : phrase;
      let from = 0;
      while (true) {
        const i = searchIn.indexOf(p, from);
        if (i < 0) break;
        out.push({ category: rule.category, match: text.slice(i, i + phrase.length) });
        from = i + Math.max(1, phrase.length);
      }
    }
  }
  return out;
}

/** TUNING hit not covered by any CORE hit substring relation on the matched surface. */
function notCoveredByCore(tuningMatch: string, coreMatches: string[]): boolean {
  return !coreMatches.some((c) => tuningMatch.includes(c) || c.includes(tuningMatch));
}

const dir = setupIsolatedStoreEnv();
try {
  const lex = await import("../../packages/core/src/mask-check-lexicon.ts");
  const gold = JSON.parse(readFileSync(join(FIXTURES, "gold.json"), "utf8"));
  const report: Record<string, unknown> = {};

  for (const [key, meta] of Object.entries(gold.samples) as [string, { file: string }][]) {
    const text = readFileSync(join(FIXTURES, meta.file), "utf8");
    const coreHits = findPhrases(text, lex.CORE_KEYWORD_RULES);
    const tuningHits = findPhrases(text, lex.TUNING_KEYWORD_RULES);
    const coreMatches = [...new Set(coreHits.map((h) => h.match))];
    const tuningMatches = [...new Set(tuningHits.map((h) => h.match))];
    const tuningOnly = tuningMatches.filter((m) => notCoveredByCore(m, coreMatches));
    report[key] = { coreMatches, tuningMatches, tuningOnly };
    console.log(`\n== ${key} ==`);
    console.log("CORE:", coreMatches);
    console.log("TUNING:", tuningMatches);
    console.log("TUNING not covered by CORE:", tuningOnly);
  }

  writeFileSync(join(ROOT, "out_core_vs_tuning.json"), JSON.stringify(report, null, 2), "utf8");
} finally {
  teardownIsolatedStoreEnv(dir);
}

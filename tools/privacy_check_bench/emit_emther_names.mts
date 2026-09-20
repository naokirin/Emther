#!/usr/bin/env node
/**
 * Emther detectNameCandidates を比較用キーで書き出す。
 * compare_name_detectors.py が読む out_emther_names.json を生成する。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setupIsolatedStoreEnv, teardownIsolatedStoreEnv } from "../../packages/core/src/test-helpers/store-env.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, "../..");
const FIXTURES = join(ROOT, "fixtures");
const SAMPLES_MD = join(REPO, "docs/security_check/security_check_samples.md");

function extractBlockquotes(md: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  for (const line of md.split("\n")) {
    if (line.startsWith(">")) cur.push(line.replace(/^>\s?/, ""));
    else if (cur.length) {
      blocks.push(cur.join("\n").trim());
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur.join("\n").trim());
  return blocks;
}

const dir = setupIsolatedStoreEnv();
try {
  const { detectNameCandidatesAsync } = await import("../../packages/core/src/mask-check.ts");
  const blocks = extractBlockquotes(readFileSync(SAMPLES_MD, "utf8"));
  const keys = ["sec1", "sec2", "sec3", "sec4", "sec5", "sec6", "sec7", "sec8", "sec9", "sec10"];
  const out: Record<string, string[]> = {};
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = await detectNameCandidatesAsync(blocks[i] ?? "");
  }
  out.incident_mtg = await detectNameCandidatesAsync(
    readFileSync(join(FIXTURES, "incident_mtg.txt"), "utf8"),
  );
  out.release_standup = await detectNameCandidatesAsync(
    readFileSync(join(FIXTURES, "release_standup.txt"), "utf8"),
  );
  const path = join(ROOT, "out_emther_names.json");
  writeFileSync(path, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
  console.error(`Wrote ${path}`);
} finally {
  teardownIsolatedStoreEnv(dir);
}

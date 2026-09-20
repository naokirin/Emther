#!/usr/bin/env node
// docs/2nd_architecture/plan.md フェーズ4.4: apps/server/dist/server.js は
// @huggingface/transformers・onnxruntime-node・kuromoji をesbuildのexternalとして
// バンドルから除外しているため、実行時に解決できるようnode_modulesへ個別配置する
// 必要がある。単純に3パッケージのディレクトリだけをコピーすると、それらが依存する
// 「ホイストされた兄弟パッケージ」（例: sharp が使う detect-libc）が漏れて
// 実行時に `Cannot find module 'detect-libc'` のようなエラーになる
// （2026-09-20 実機smoke testで発覚）。
//
// @vercel/nft（Next.jsのstandalone出力が内部で使うのと同じ依存関係トレーサー）で
// dist/server.js の実際のrequire/importグラフを辿り、必要なnode_modules配下の
// ファイルだけを最小限コピーする。
//
// 注意: kuromoji は createRequire(import.meta.url) 経由の動的requireのため
// nftの静的解析では検出できない（トレース結果に一切現れないことを確認済み）。
// 加えて辞書データ（dict/配下）はJSのrequire/importグラフに乗らないため、
// nftでは原理的にトレースできない。そのため kuromoji は常にディレクトリ
// まるごとを別途コピーする（呼び出し側のpackage-standalone.shで実施）。
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { nodeFileTrace } from "@vercel/nft";

const [, , entryArg, rootArg, destArg] = process.argv;
if (!entryArg || !rootArg || !destArg) {
  console.error("usage: trace-server-deps.mjs <entry.js> <root> <dest-app-dir>");
  process.exit(1);
}

const root = path.resolve(rootArg);
const entry = path.resolve(entryArg);
const dest = path.resolve(destArg);

const { fileList } = await nodeFileTrace([entry], { base: root });

let copied = 0;
for (const rel of fileList) {
  if (!rel.startsWith("node_modules/")) continue; // ソース自体はesbuildで既にバンドル済み
  const src = path.join(root, rel);
  const out = path.join(dest, rel);
  mkdirSync(path.dirname(out), { recursive: true });
  cpSync(src, out, { recursive: true });
  copied++;
}
console.log(`[trace-server-deps] copied ${copied} files (node_modules) into ${dest}`);

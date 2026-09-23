import { mkdirSync, existsSync, readdirSync, cpSync, statSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { env } from "@huggingface/transformers";
import { createNodeTransformersCache } from "./transformers-file-cache";

// Transformers.js の既定 cacheDir はパッケージ配下 `.cache/`。配布では
// 業務データと分けて XDG キャッシュへ置く（docs/packaging.md）。
// 以前パッケージ配下へ落としたファイルがあれば起動時にコピーして再利用する。

let configuredCacheDir: string | null = null;

export function defaultTransformersCacheDir(): string {
  const override = process.env.EM_TRANSFORMERS_CACHE_DIR?.trim();
  if (override) return override;
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  const cacheRoot = xdg && xdg.length > 0 ? xdg : join(homedir(), ".cache");
  return join(cacheRoot, "emther", "transformers");
}

export function getTransformersCacheDir(): string {
  return configuredCacheDir ?? defaultTransformersCacheDir();
}

/** パッケージの exports は package.json を公開しないので、エントリから親を辿る。 */
export function bundledPackageCacheDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("@huggingface/transformers");
    let dir = dirname(entry);
    for (let i = 0; i < 6; i++) {
      const pkgJson = join(dir, "package.json");
      if (existsSync(pkgJson)) {
        try {
          const name = JSON.parse(readFileSync(pkgJson, "utf8")).name;
          if (name === "@huggingface/transformers") return join(dir, ".cache");
        } catch {
          // package.json が壊れていても親へ進む
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * src にあって dest に無い（またはサイズが違う）ファイルだけコピーする。
 * 途中失敗で tokenizer だけ残っている場合でも、ONNX をパッケージ側から補完できる。
 */
export function copyMissingCacheFiles(src: string, dest: string): number {
  if (!existsSync(src) || src === dest) return 0;
  const srcStat = statSync(src);
  if (srcStat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    let copied = 0;
    for (const name of readdirSync(src)) {
      copied += copyMissingCacheFiles(join(src, name), join(dest, name));
    }
    return copied;
  }
  if (existsSync(dest)) {
    try {
      if (statSync(dest).size === srcStat.size) return 0;
    } catch {
      // dest が読めなければ上書きする
    }
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
  return 1;
}

/** パッケージ同梱キャッシュ（過去のダウンロード）を XDG 側へ一度コピーする。 */
export function seedTransformersCacheFromPackage(dest: string): void {
  if (process.env.VITEST === "true") return;
  const src = bundledPackageCacheDir();
  if (!src || !existsSync(src) || src === dest) return;
  try {
    const copied = copyMissingCacheFiles(src, dest);
    if (copied > 0) {
      console.info(`[emther] transformers キャッシュを ${copied} ファイル補完: ${src} → ${dest}`);
    }
  } catch (err) {
    console.warn("[transformers-env] パッケージキャッシュのコピーに失敗:", err);
  }
}

function installNodeCache(cacheDir: string): void {
  if (!env || typeof env !== "object") return;
  env.cacheDir = cacheDir;
  env.useFSCache = true;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = createNodeTransformersCache(cacheDir);
  const orig = typeof env.fetch === "function" ? env.fetch.bind(env) : globalThis.fetch.bind(globalThis);
  env.fetch = async (input: string | URL, init?: RequestInit) => {
    const res = await orig(input, init);
    if (res instanceof Response) return res;
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}

/** `pipeline()` より先に呼び、書き込み可能な cacheDir を固定する。 */
export function configureTransformersEnv(): string {
  const cacheDir = defaultTransformersCacheDir();
  configuredCacheDir = cacheDir;
  installNodeCache(cacheDir);
  try {
    mkdirSync(cacheDir, { recursive: true });
    seedTransformersCacheFromPackage(cacheDir);
  } catch (err) {
    console.warn("[transformers-env] cache dir を作成できませんでした:", cacheDir, err);
  }
  if (process.env.VITEST !== "true") {
    console.info(`[emther] transformers cacheDir=${cacheDir}`);
  }
  return cacheDir;
}

configureTransformersEnv();

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const env = { cacheDir: "unset" };
vi.mock("@huggingface/transformers", () => ({ env }));

describe("transformers-env", () => {
  const previousOverride = process.env.EM_TRANSFORMERS_CACHE_DIR;
  const previousXdg = process.env.XDG_CACHE_HOME;
  const created: string[] = [];

  afterEach(() => {
    if (previousOverride === undefined) delete process.env.EM_TRANSFORMERS_CACHE_DIR;
    else process.env.EM_TRANSFORMERS_CACHE_DIR = previousOverride;
    if (previousXdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousXdg;
    for (const dir of created.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    vi.resetModules();
  });

  it("EM_TRANSFORMERS_CACHE_DIR を優先しディレクトリを作る", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emther-xf-"));
    created.push(dir);
    const cache = join(dir, "cache");
    process.env.EM_TRANSFORMERS_CACHE_DIR = cache;
    delete process.env.XDG_CACHE_HOME;
    vi.resetModules();
    env.cacheDir = "unset";
    const mod = await import("./transformers-env");
    expect(mod.getTransformersCacheDir()).toBe(cache);
    expect(env.cacheDir).toBe(cache);
    expect(existsSync(cache)).toBe(true);
  });

  it("XDG_CACHE_HOME があるときはその下の emther/transformers を使う", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emther-xdg-"));
    created.push(dir);
    delete process.env.EM_TRANSFORMERS_CACHE_DIR;
    process.env.XDG_CACHE_HOME = dir;
    vi.resetModules();
    env.cacheDir = "unset";
    const mod = await import("./transformers-env");
    expect(mod.getTransformersCacheDir()).toBe(join(dir, "emther", "transformers"));
    expect(env.cacheDir).toBe(join(dir, "emther", "transformers"));
  });

  it("上書きが無ければ ~/.cache/emther/transformers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emther-def-"));
    created.push(dir);
    process.env.EM_TRANSFORMERS_CACHE_DIR = dir;
    vi.resetModules();
    const mod = await import("./transformers-env");
    delete process.env.EM_TRANSFORMERS_CACHE_DIR;
    delete process.env.XDG_CACHE_HOME;
    expect(mod.defaultTransformersCacheDir()).toBe(join(homedir(), ".cache", "emther", "transformers"));
  });

  it("欠けているキャッシュファイルだけ補完し、同じサイズの既存ファイルは残す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emther-seed-"));
    created.push(dir);
    const src = join(dir, "src");
    const dest = join(dir, "dest");
    mkdirSync(join(src, "Xenova", "model", "onnx"), { recursive: true });
    mkdirSync(join(dest, "Xenova", "model"), { recursive: true });
    writeFileSync(join(src, "Xenova", "model", "tokenizer.json"), "full-tokenizer");
    writeFileSync(join(src, "Xenova", "model", "onnx", "model.onnx"), "onnx-bytes");
    writeFileSync(join(dest, "Xenova", "model", "tokenizer.json"), "partial");

    process.env.EM_TRANSFORMERS_CACHE_DIR = join(dir, "unused");
    vi.resetModules();
    const { copyMissingCacheFiles } = await import("./transformers-env");
    expect(copyMissingCacheFiles(src, dest)).toBe(2);
    expect(readFileSync(join(dest, "Xenova", "model", "tokenizer.json"), "utf8")).toBe("full-tokenizer");
    expect(readFileSync(join(dest, "Xenova", "model", "onnx", "model.onnx"), "utf8")).toBe("onnx-bytes");
    expect(copyMissingCacheFiles(src, dest)).toBe(0);
  });

  it("bundledPackageCacheDir は package.json exports を使わず .cache を見つける", async () => {
    process.env.EM_TRANSFORMERS_CACHE_DIR = mkdtempSync(join(tmpdir(), "emther-pkg-"));
    created.push(process.env.EM_TRANSFORMERS_CACHE_DIR);
    vi.resetModules();
    const { bundledPackageCacheDir } = await import("./transformers-env");
    const cache = bundledPackageCacheDir();
    expect(cache).toBeTruthy();
    expect(cache!.replace(/\\/g, "/")).toMatch(/@huggingface\/transformers\/\.cache$/);
  });
});

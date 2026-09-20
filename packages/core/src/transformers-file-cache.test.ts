import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cacheRequestToRelPath, createNodeTransformersCache } from "./transformers-file-cache";

describe("transformers-file-cache", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const dir of created.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("HF resolve URL を FileCache と同じ相対パスにする", () => {
    expect(
      cacheRequestToRelPath(
        "https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-202606-ONNX/resolve/main/onnx/model_q4.onnx",
      ),
    ).toBe("LiquidAI/LFM2.5-1.2B-JP-202606-ONNX/onnx/model_q4.onnx");
    expect(
      cacheRequestToRelPath("https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer.json"),
    ).toBe("Xenova/paraphrase-multilingual-MiniLM-L12-v2/tokenizer.json");
  });

  it("相対キーはそのまま使う", () => {
    expect(cacheRequestToRelPath("Xenova/foo/onnx/model.onnx")).toBe("Xenova/foo/onnx/model.onnx");
    expect(cacheRequestToRelPath("/Xenova/foo/onnx/model.onnx")).toBe("Xenova/foo/onnx/model.onnx");
  });

  it("match は JSON を Response、ONNX をパス文字列で返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emther-fc-"));
    created.push(dir);
    mkdirSync(join(dir, "Xenova", "foo", "onnx"), { recursive: true });
    writeFileSync(join(dir, "Xenova", "foo", "tokenizer.json"), "tok");
    writeFileSync(join(dir, "Xenova", "foo", "onnx", "model.onnx"), "onnx");

    const cache = createNodeTransformersCache(dir);
    const jsonHit = await cache.match("https://huggingface.co/Xenova/foo/resolve/main/tokenizer.json");
    expect(jsonHit).toBeInstanceOf(Response);
    expect(await (jsonHit as Response).text()).toBe("tok");

    const onnxHit = await cache.match("Xenova/foo/onnx/model.onnx");
    expect(onnxHit).toBe(join(dir, "Xenova/foo/onnx/model.onnx"));
    await expect(cache.match("Xenova/foo/missing.json")).resolves.toBeUndefined();
  });

  it("put は Response をファイルに書き match で見つかる", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emther-fp-"));
    created.push(dir);
    const cache = createNodeTransformersCache(dir);
    const body = "onnx-bytes";
    await cache.put(
      "https://huggingface.co/LiquidAI/demo/resolve/main/onnx/model.onnx",
      new Response(body, { headers: { "content-length": String(body.length) } }),
    );
    const path = await cache.match("LiquidAI/demo/onnx/model.onnx");
    expect(typeof path).toBe("string");
    expect(existsSync(path as string)).toBe(true);
    expect(readFileSync(path as string, "utf8")).toBe(body);
  });
});

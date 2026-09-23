import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

// Transformers.js 4.2 は Node の return_path 時、ダウンロード直後の
// cache.match が FileResponse 以外だと "Unable to get model file path or buffer"
// を投げる。ライブラリ内部の `new Promise(async …)` がそれを unhandledRejection
// にする。ONNX はパス文字列、JSON 等は Response を返すと両方の呼び出し方が通る。
// customCache 利用時のキーは HF URL になるため、FileCache と同じ相対パスへ正規化する。

export function cacheRequestToRelPath(request: string): string {
  const trimmed = request.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const parts = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
      const resolveAt = parts.indexOf("resolve");
      if (resolveAt > 0 && parts.length > resolveAt + 1) {
        const model = parts.slice(0, resolveAt).join("/");
        const file = parts.slice(resolveAt + 2).join("/");
        return file ? `${model}/${file}` : model;
      }
      return parts.join("/");
    } catch {
      return trimmed.replace(/^https?:\/\//i, "");
    }
  }
  return trimmed.replace(/^\/+/, "");
}

export function isOnnxWeightPath(relPath: string): boolean {
  return /\.onnx(_data(?:_\d+)?)?$/i.test(relPath);
}

export type TransformersCache = {
  match: (request: string) => Promise<string | Response | undefined>;
  put: (
    request: string,
    response: Response,
    progress_callback?: (data: { progress: number; loaded: number; total: number }) => void,
  ) => Promise<void>;
};

export function createNodeTransformersCache(cacheDir: string): TransformersCache {
  const filePathFor = (request: string) => join(cacheDir, cacheRequestToRelPath(request));

  return {
    async match(request: string) {
      const relPath = cacheRequestToRelPath(request);
      const filePath = filePathFor(request);
      if (!existsSync(filePath)) return undefined;
      // ONNX はディスクパスが必要（external data は相対パス解決）。
      // tokenizer/config は getModelText がバッファを decode する。
      if (isOnnxWeightPath(relPath)) return filePath;
      const buf = await readFile(filePath);
      return new Response(buf, {
        status: 200,
        headers: { "content-length": String(buf.byteLength) },
      });
    },

    async put(request, response, progress_callback) {
      const filePath = filePathFor(request);
      const tmpPath = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
      await mkdir(dirname(filePath), { recursive: true });
      try {
        const total = parseInt(response.headers.get("content-length") ?? "0", 10) || 0;
        let loaded = 0;
        const fileStream = createWriteStream(tmpPath);

        const writeChunk = async (chunk: Uint8Array) => {
          await new Promise<void>((resolve, reject) => {
            fileStream.write(chunk, (err) => (err ? reject(err) : resolve()));
          });
          loaded += chunk.byteLength;
          progress_callback?.({
            progress: total ? (loaded / total) * 100 : 0,
            loaded,
            total,
          });
        };

        if (response.body && typeof response.body.getReader === "function") {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) await writeChunk(value);
          }
        } else {
          await writeChunk(new Uint8Array(await response.arrayBuffer()));
        }

        await new Promise<void>((resolve, reject) => {
          fileStream.close((err) => (err ? reject(err) : resolve()));
        });
        await rename(tmpPath, filePath);
      } catch (err) {
        try {
          await unlink(tmpPath);
        } catch {
          // 一時ファイルが残っても次回 put で上書きする
        }
        throw err;
      }
    },
  };
}

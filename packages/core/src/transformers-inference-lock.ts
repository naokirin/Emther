/**
 * Transformers.js / onnxruntime-node は並列 session.run で RSS が急増することがある
 * （consult 3 specialist 並行時に数 GB まで膨らんだ実測あり）。
 * 埋め込み・ rerank の推論をプロセス内で直列化する。
 */
let tail: Promise<unknown> = Promise.resolve();

export function withTransformersInferenceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

import type { ErrorHandler } from "hono";

// docs/2nd_architecture/plan.md フェーズ2.7: 各ルートは基本的に自前でtry/catch +
// jsonFromUnknownError（このディレクトリのname-candidate-response.ts）を使って
// エラーをJSONへ変換しているため、ここに落ちてくるのは想定外のバグに近い最終防波堤。
// プロセスを落とさず500 JSONで返す（Honoの既定のエラーページより一貫性がある）。
export const honoErrorHandler: ErrorHandler = (err, c) => {
  console.error("[emther-server] unhandled route error", err);
  return c.json({ error: err instanceof Error ? err.message : "internal error" }, 500);
};

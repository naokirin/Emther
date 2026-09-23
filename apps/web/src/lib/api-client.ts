// Hono RPC クライアント。AppType は apps/server の API 面（静的配信・onError 除く）。
// OpenAPI（@hono/zod-openapi）は後追い予定。契約スキーマは @emther/api-contract。
//
// レスポンス型: ルートにバリデータが無い間は InferResponseType が緩いため、
// 呼び出し側で従来どおり明示型（rpcJsonAs<T>）を付ける。api-contract にレスポンス
// スキーマを足したルートから順に厳密化できる。
import { hc } from "hono/client";
import type { AppType } from "@emther/server/app";

export const api = hc<AppType>("/");

export async function rpcJsonAs<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`request failed: ${label} (${res.status})`);
  }
  return (await res.json()) as T;
}

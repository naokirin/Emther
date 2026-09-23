// Hono RPC クライアント。AppType は apps/server の API 面（静的配信・onError 除く）。
// OpenAPI（@hono/zod-openapi）は後追い予定。契約スキーマは @emther/api-contract。
//
// レスポンス型: ルートにバリデータが無い間は InferResponseType が緩いため、
// 呼び出し側で従来どおり明示型（rpcJsonAs<T>）を付ける。api-contract にレスポンス
// スキーマを足したルートから順に厳密化できる。
import { hc } from "hono/client";
import type { AppType } from "@emther/server/app";

export const api = hc<AppType>("/");

/** Hono RPC が param と json の同時指定を型上許さない場合の回避。 */
export function rpcInit<T extends object>(init: T): never {
  return init as never;
}

export async function rpcData<T>(res: Response): Promise<T | null> {
  return (await res.json().catch(() => null)) as T | null;
}

export async function rpcJsonAs<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`request failed: ${label} (${res.status})`);
  }
  return (await res.json()) as T;
}

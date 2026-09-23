// Hono RPC クライアント。AppType は apps/server の API 面（静的配信・onError 除く）。
// OpenAPI（@hono/zod-openapi）は後追い予定。契約スキーマは @emther/api-contract。
import { hc } from "hono/client";
import type { AppType } from "@emther/server/app";

export const api = hc<AppType>("/");

/** RPC レスポンスを JSON 化し、非 2xx は throw（旧 fetchJson と同じ契約）。 */
export async function rpcJson<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`request failed: ${label} (${res.status})`);
  }
  return (await res.json()) as T;
}

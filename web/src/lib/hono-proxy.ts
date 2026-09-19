// フェーズ2（Hono並走）専用の薄いフォワーダ。Next Route Handlerを
// apps/server（Hono、別ポートで常駐）へそのまま転送し、レスポンスをそのまま返す。
// 実処理はNext側からapps/serverへ完全に移設済みで、ここにはドメインロジックを置かない。
// docs/2nd_architecture/plan.md フェーズ2.3・docs/2nd_architecture/dev-hybrid-rules.md
const HONO_BASE_URL = process.env.HONO_SERVER_URL ?? `http://127.0.0.1:${process.env.HONO_PORT ?? "8787"}`;

export async function proxyToHono(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, HONO_BASE_URL);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const response = await fetch(target, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? request.body : undefined,
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

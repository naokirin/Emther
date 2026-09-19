// APIルートのハンドラ（Next.js App Router）を、サーバーを起動せず直接importして
// 呼び出すためのテスト用ヘルパー。GET/POST等は標準のWeb Request/Responseを受け取る
// 素の関数なので、サーバー無しでも十分検証できる。

export function jsonRequest(url: string, method: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

// 動的ルート（[id]等）のRouteContext相当。Next.js 15+のparamsはPromiseなので、
// 解決済みのPromiseでラップして渡す。
export function routeCtx<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

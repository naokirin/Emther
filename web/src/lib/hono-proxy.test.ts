import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyToHono } from "./hono-proxy";

type FetchInit = RequestInit & { duplex?: string };

function mockFetch(response: Response) {
  return vi.fn<(target: URL, init: FetchInit) => Promise<Response>>().mockResolvedValue(response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("proxyToHono", () => {
  it("GETをapps/server（既定ポート8787）へ転送し、レスポンスをそのまま返す", async () => {
    const fetchMock = mockFetch(
      new Response(JSON.stringify({ entries: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("http://localhost/api/timeline");
    const res = await proxyToHono(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe("http://127.0.0.1:8787/api/timeline");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });

  it("クエリ文字列を維持しつつ転送する", async () => {
    const fetchMock = mockFetch(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyToHono(new Request("http://localhost/api/id-resolve?q=abc123"));

    const [target] = fetchMock.mock.calls[0];
    expect(String(target)).toBe("http://127.0.0.1:8787/api/id-resolve?q=abc123");
  });

  it("POST等のbodyを転送する（duplex: half付き）", async () => {
    const fetchMock = mockFetch(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("http://localhost/api/glossary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term: "a", meaning: "b" }),
    });
    const res = await proxyToHono(request);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).not.toBeUndefined();
    expect(init.duplex).toBe("half");
    expect(res.status).toBe(201);
  });
});

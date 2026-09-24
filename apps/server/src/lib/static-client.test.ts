import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountStaticClient } from "./static-client";

// 単一プロセス配信の静的配信 + SPA
// フォールバックを、実ファイル配置に対する直接requestで検証する
describe("mountStaticClient", () => {
  let clientDir: string;
  let app: Hono;

  beforeEach(() => {
    clientDir = mkdtempSync(path.join(tmpdir(), "emther-static-client-"));
    writeFileSync(path.join(clientDir, "index.html"), "<!doctype html><html><body>spa</body></html>");
    writeFileSync(path.join(clientDir, "app.js"), "console.log('asset');");

    app = new Hono();
    app.get("/api/health", (c) => c.json({ ok: true }));
    mountStaticClient(app, clientDir);
  });

  afterEach(() => {
    rmSync(clientDir, { recursive: true, force: true });
  });

  it("既存の静的ファイルはそのまま配信される", async () => {
    const res = await app.request("/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log('asset');");
  });

  it("/api/* のAPIルートは静的配信より優先して届く", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("静的ファイルに一致しないGETはSPAのindex.htmlへフォールバックする（React Routerのクライアントサイドルーティング用）", async () => {
    const res = await app.request("/suggestions/abc123");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("spa");
  });

  it("未知の/api/*パスはindex.htmlへフォールバックせずJSON 404のまま", async () => {
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: "not_found" });
  });
});

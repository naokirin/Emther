import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { honoErrorHandler } from "./error-handling";

// docs/2nd_architecture/plan.md フェーズ2.7: createApp()（app.ts）に配線している
// honoErrorHandlerが、ルートハンドラ内の同期スローをHonoのリクエスト処理チェーン内で
// 拾い、プロセスを落とさず500 JSONへ変換できることを確認する。
describe("honoErrorHandler", () => {
  it("ルートハンドラが投げたErrorを500 JSONへ変換する", async () => {
    const app = new Hono().onError(honoErrorHandler).get("/boom", () => {
      throw new Error("boom");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });

  it("非同期ハンドラのrejectも500 JSONへ変換する", async () => {
    const app = new Hono().onError(honoErrorHandler).get("/boom", async () => {
      throw new Error("async boom");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "async boom" });
  });
});

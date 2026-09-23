# @emther/api-contract

Hono API の入出力 Zod スキーマ（共有契約層）。

## 方針

- **置き場**: スキーマはここ。ドメインロジックは `@emther/core`。
- **クライアント接続**: `apps/web` は Hono RPC（`hc<AppType>`）。`AppType` は `@emther/server/app`。
- **OpenAPI**（`@hono/zod-openapi`）: 後追い。スキーマさえあれば追加しやすい。
- **検証の厳しさ**
  - `journal` / `settings/rules` のリクエスト: **寛容**（不正型 → 未指定）。既存テスト・UX で固定。
  - `health` / `timeline` のレスポンス: **厳密な形の記述**（`satisfies` でサーバー側ドリフト防止）。

## 初手スコープ

| モジュール | 内容 |
| --- | --- |
| `health` | `GET /api/health` レスポンス |
| `timeline` | `GET /api/timeline` レスポンス |
| `journal` | POST / PATCH / bulk リクエスト body |
| `settings-rules` | PATCH の単純 number/boolean |

`apps/web/src/lib/queries.ts` のポーリング GET は Hono RPC（`hc<AppType>`）経由。レスポンス型は当面 `rpcJsonAs<T>` で明示し、ここにレスポンススキーマを足したルートから厳密化できる。

横展開するときは新規・改修ルートからスキーマをここに追加し、サーバーで import、必要なら web のミューテーション側 `fetch` も RPC に置換する。

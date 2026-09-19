# 開発時のハイブリッド構成 並走ルール

作成日: 2026-09-19（フェーズ2.4、0.5のドラフト方針を文書化）
関連文書: `docs/2nd_architecture.md`（方針）/ `docs/2nd_architecture/plan.md`（詳細計画。6.2節に開発体験の見立て）

本ドキュメントは、フェーズ2（Hono並走）〜フェーズ3（Vite SPA立ち上げ）の間、`next dev` と `apps/server`（Hono）／`vite dev` が同時に存在する期間の「今どのdevサーバーで確認すべきか」を判断するためのルールを記録する。フェーズが進むごとに更新する。

---

## 1. 現在の段階（フェーズ2: Hono並走）

- **ブラウザから見るのは常に `next dev`（`web/`）のみ。** `apps/server`（Hono）は Next の Route Handler からプロキシされるバックエンドとして裏で動くだけで、ブラウザから直接叩く対象ではない（唯一の例外は `apps/server` 自体の開発中に `curl` 等で動作確認する場合）。
- Route Handler が `web/src/lib/hono-proxy.ts` の `proxyToHono` に置き換わっている API（下記「移植済みルート」参照）は、実処理が `apps/server/src/routes/**` にある。挙動を直すときは **`apps/server` 側のファイルを編集する**（`web/src/app/api/**/route.ts` 側はフォワードするだけで、ここを直しても反映されない）。
- 移植済みルートを確認するには、2つのプロセスを同時に起動する。
  ```bash
  # 1つ目のターミナル: Hono（apps/server）
  npm run dev -w @emther/server   # 既定 http://127.0.0.1:8787

  # 2つ目のターミナル: Next（web）
  npm run dev -w web              # 既定 http://localhost:3000
  ```
  `apps/server` を起動し忘れると、移植済みルートへのリクエストは Next 側のプロキシが `fetch` に失敗し 500 系で落ちる。「該当APIだけ動かない」ときはまずこの起動漏れを疑う。
- ポート・接続先を変える場合は環境変数で上書きする（`apps/server` 側 `HONO_PORT` / `HONO_HOST`、`web` 側 `HONO_SERVER_URL` または `HONO_PORT`）。両者は独立した値なので、片方だけ変えると不整合になる点に注意。

## 2. 「どちらを直すか」の判断表

| やりたいこと | 触る場所 |
| --- | --- |
| 移植済みAPIの挙動を直す・機能追加する | `apps/server/src/routes/**`（+ 必要なら `packages/core`） |
| 未移植APIの挙動を直す・機能追加する | 従来どおり `web/src/app/api/**/route.ts`（+ `packages/core`） |
| 画面（UI）を直す | 従来どおり `web/src/app/**/page.tsx` 等（フェーズ3まで変わらない） |
| 新規APIを作る | 2.2の移行順位付けに沿って `apps/server` 側に新設するのが既定。並走を増やしたくない小さな内部専用APIのみ例外的にNext側に残す判断もあり得るが、増やす場合はこの表を更新する |

## 3. 移植済みルート一覧（このセクションはバッチを追加するたびに更新する）

- `GET/POST /api/glossary`, `GET/PATCH/DELETE /api/glossary/:id`
- `GET /api/vitals`
- `GET /api/timeline`
- `GET /api/id-resolve`
- `GET /api/knowledge/events`
- `GET/POST /api/teams`, `PATCH/DELETE /api/teams/:id`, `POST /api/teams/:id/archive`, `POST /api/teams/bulk`
- `GET/POST /api/org/background`, `PATCH/DELETE /api/org/background/:id`

対応する実装: `apps/server/src/routes/{glossary,vitals,timeline,id-resolve,knowledge-events,teams,org-background}.ts`（`apps/server/src/app.ts` でマウント）。

## 4. まだ決めていないこと（フェーズ2.5以降で追記）

- バッチが増えて `apps/server` 側のルート数が多くなったときの、ルーティング整理方針（現状は1ファイル1リソースのフラット構成）。
- E2E的な動作確認（`emther doctor` 相当）を2プロセス構成でどう行うか。
- フェーズ3で `vite dev` が増えたときの3プロセス構成での同様のルール（本ドキュメントに追記する）。

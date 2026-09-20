# 開発時のハイブリッド構成 並走ルール

作成日: 2026-09-19（フェーズ2.4、0.5のドラフト方針を文書化）
関連文書: `docs/2nd_architecture.md`（方針）/ `docs/2nd_architecture/plan.md`（詳細計画。6.2節に開発体験の見立て）

本ドキュメントは、フェーズ2（Hono並走）〜フェーズ3（Vite SPA立ち上げ）の間、`next dev` と `apps/server`（Hono）／`vite dev` が同時に存在する期間の「今どのdevサーバーで確認すべきか」を判断するためのルールを記録する。フェーズが進むごとに更新する。

---

## 1. フェーズ2時点の段階（フェーズ2: Hono並走。**2026-09-20時点で陳腐化、10節を正とする**）

> このセクションはフェーズ2（`apps/web`着手前）時点の記録として残す。フェーズ3.5完了（2026-09-20、21画面の移植完了）以降は、ブラウザ確認の既定は`vite dev`（`apps/web`）+ `apps/server`に変わっている。最新のdevサーバー判断は**10節**を参照すること。

- **（フェーズ2当時）ブラウザから見るのは常に `next dev`（`web/`）のみ。** `apps/server`（Hono）は Next の Route Handler からプロキシされるバックエンドとして裏で動くだけで、ブラウザから直接叩く対象ではない（唯一の例外は `apps/server` 自体の開発中に `curl` 等で動作確認する場合）。localhost向けのcurlは `safe-curl`（利用可能な環境では通常の`curl`ではなくこちらを使う）。手動smoke test用の一時ディレクトリ削除は `rm -rf` ではなく `rm-tmp <path>`（`/tmp` 配下限定の削除ラッパー、利用可能な環境ではこちらを使う）。
- **手動でmutatingなエンドポイントを確認する際は必ず環境変数（`EM_DATA_DIR`/`EM_SECURE_DATA_DIR`/`EM_BACKUP_DIR`）を一時ディレクトリへ向けること。** 自動テストは`setupIsolatedStoreEnv`で担保されるが、手動確認はこのガードの外にある（フェーズ2.3で実データを誤って書き換えた事故の教訓。`plan.md`参照）。
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
- `GET/POST /api/reports`, `PATCH /api/reports/:id`
- `GET /api/growth/suggestions`, `PATCH /api/growth/suggestions/:id`
- `GET/POST /api/em-self/checkins`
- `GET/POST /api/em-self/reflection-notes`, `PATCH /api/em-self/reflection-notes/:id`
- `GET/POST /api/people`, `GET/PATCH/DELETE /api/people/:id`, `POST /api/people/:id/merge`, `PATCH /api/people/:id/concern-acks/:issueId`, `GET/POST /api/people/:id/evaluation-logs`, `PATCH /api/people/:id/evaluation-logs/:logId`
- `GET/POST /api/org/objectives`, `PATCH/DELETE /api/org/objectives/:id`, `POST /api/org/objectives/:id/key-results`, `PATCH/DELETE /api/org/objectives/:id/key-results/:krId`, `POST /api/org/objectives/import`
- `GET/PATCH /api/org/strategy`
- `GET/POST /api/journal`, `GET/PATCH /api/journal/:id`, `POST/DELETE /api/journal/:id/archive`, `POST/DELETE /api/journal/:id/no-action-needed`, `POST /api/journal/bulk`, `GET /api/journal/search`, `POST /api/journal/:id/analyze`, `POST /api/journal/batch`
- `GET/PATCH /api/settings/rules`
- `GET/POST /api/themes`, `GET/PATCH /api/themes/:id`, `POST /api/themes/from-okr`, `POST /api/themes/distill`
- `GET/POST /api/agents`, `GET /api/agents/inbox`, `GET /api/agents/:id`, `POST /api/agents/:id/decide`, `POST /api/agents/:id/review`, `POST/DELETE /api/agents/:id/themes`, `POST/DELETE /api/agents/:id/suggestion-updates`, `POST /api/agents/:id/charter/dismiss`, `POST /api/agents/:id/sub-issues/dismiss`, `POST/DELETE /api/agents/:id/issue-notes`, `POST /api/agents/pending-unmasked/:id`
- `GET/POST /api/issues`, `GET/PATCH /api/issues/:id`
- `GET/POST /api/suggestions`, `GET/PATCH /api/suggestions/:id`, `POST /api/suggestions/:id/memo`
- `POST /api/growth/generate`
- `GET/POST /api/models/status`, `POST /api/mask-check`, `POST /api/journal/local-summarize`, `GET/POST /api/knowledge/interpretations`
- `POST /api/settings/data/backup`（`settings/data/reset`・`settings/data/restore`は`process.exit`を呼ぶため意図的に未移植。5節参照）
- `GET/POST /api/journal/dumps`, `GET/PATCH /api/journal/dumps/:id`, `POST /api/journal/dumps/:id/parse`, `POST /api/journal/dumps/:id/accept`, `POST /api/journal/dumps/preview`, `GET/POST/DELETE /api/journal/dumps/profiles`
- `POST /api/org/objectives/parse`, `POST /api/issues/link/suggest`, `POST /api/themes/link/suggest`

**フェーズ2.5、実質完了（2026-09-19）。** 低リスク41ルート・高リスク34ルート（`settings/data/reset`・`settings/data/restore`を除く）全ての移植が完了した。残る未移植は`settings/data/reset`・`settings/data/restore`の2ルートのみで、フェーズ4（単一プロセス配信）まで意図的にNext側に残す（5節参照）。次は2.6（Zod導入）・2.7（完了基準の最終確認）。

対応する実装: `apps/server/src/routes/{glossary,vitals,timeline,id-resolve,knowledge-events,teams,org-background,reports,growth-suggestions,em-self,people,org-objectives,org-strategy,journal,settings-rules,themes,agents,issues,suggestions,themes-distill,growth-generate,models-status,mask-check,journal-local-summarize,knowledge-interpretations,settings-data-backup,journal-dumps,org-objectives-parse,issues-link-suggest,themes-link-suggest}.ts`（`agents.ts`が`agentsRoute`/`agentsInboxRoute`/`agentsPendingUnmaskedRoute`の3つのHonoインスタンスをエクスポートし、それぞれ別パスにマウントされる。`apps/server/src/app.ts` でマウント）。共有ヘルパーは `apps/server/src/lib/name-candidate-response.ts`（`packages/core/src/name-candidate-response.ts` のHono版アダプタ）。

## 4. agent-runtime系ルートを移植する際の注意（高リスク側）

- `agent-runtime`（`scheduled-tasks.ts`）をimportするルートをHono側へ移植すると、Next側watchdogと合わせて30秒間隔の自動バッチチェックが2プロセスで同時に走る。既存の3層二重起動ガード（globalThisクレーム・ファイル永続化・DB上の当日run存在チェック）はいずれも単一プロセス内の同期実行を前提にしており、複数OSプロセス間のTOCTOUは防げない。フェーズ2.7で2プロセスを実機起動して**実際に重複起動（1ミリ秒差でauto-summary runが2件作成）を確認**したため、`auto_batch_claims`テーブル（SQLite UNIQUE制約による原子的クレーム）を4つの自動バッチ関数全てに追加し、起動直前の最終ゲートとした（詳細は`plan.md`フェーズ2.7参照）。新しい自動バッチ種別を追加する場合も、`start*()`を呼ぶ直前に`tryClaimAutoBatchSlot()`で原子的にクレームすること。
- `POST`系（agent起動を伴うもの）は実際のCLIプロセスを起動しうるため、手動`safe-curl`では叩かない。GETのみで疎通確認し、POSTの検証は`node:child_process`の`spawn`をモックした自動テストに委ねる。

## 5. プロセスを終了させるルート（`process.exit`系）は並走期間中は移植しない

- `settings/data/reset`・`settings/data/restore`は`state-archive.ts`の`scheduleProcessExit()`（`setTimeout`後に`process.exit(0)`）を呼ぶ。これは「呼び出し元プロセス自身」を終了させるため、Hono側へ移植すると操作のたびに`apps/server`プロセスだけが落ち、Next.js（ユーザーが実際にアクセスする側、`scripts/emther`が監視・再起動する対象）はプロキシ先が死んだ壊れた状態のまま生き残る。
- この2ルートは**フェーズ4（単一プロセス配信への集約）まで意図的にNext側に残す**（`plan.md`のリスクレジスタ・フェーズ2.7完了基準の例外事項を参照）。同様に「呼び出し元プロセスを終了させる」処理を持つ未移植ルートが今後見つかった場合も同じ基準で判断する。

## 6. 新しいルートをmountする際の必須チェック（マウント順バグ）

- **あるprefix配下のサブパスを別ファイルへ切り出す**とき（例: `/api/foo`が既に`:id`ワイルドカードを持つ状態で、`/api/foo/bar`を別ファイル・別Honoインスタンスとして新設する）、`apps/server/src/app.ts`では**サブパス側を親より必ず先に`app.route()`する**こと。Honoは別々にmountしたサブアプリ間でprefixが重なる場合、静的パスを優先せず「先にmountされた方」が勝つ（単一Honoインスタンス内でのstatic-vs-`:id`優先とは異なる挙動）。
- 2026-09-19（フェーズ2.5 高リスク バッチ9）に`GET /api/journal/dumps`が`journalRoute`の`GET /:id`に飲まれる実害のあるバグとして発覚した（`journal/local-summarize`・`themes/distill`はPOST専用のため実害は無かったが同じ落とし穴を踏んでいた）。`apps/server/src/routes/*.test.ts`は各ルートのHonoインスタンスを直接requestするため、この種の合成順序バグを検出できない。
- 新しいルートを追加したら、**`apps/server/src/app.test.ts`（合成済み`app`への直接リクエストで確認する回帰テスト）に該当パスの確認項目を追記する**こと。手動`safe-curl`でも合成済みの実サーバー（`npm run dev -w @emther/server`）に対して疎通確認するのが望ましい。

## 7. ローカルMLを起動するエンドポイントの手動確認について

- `journal`（POST系）・`models/status`（GET含む、`ensureLocalModels()`をfire-and-forgetで発火）等、`local-model`/`embeddings`を実際にロードするルートは、モデル未ダウンロードの開発環境では`safe-curl`での手動確認がプロセスクラッシュを起こしうる（1節参照、フェーズ2.5バッチ6・7で発見）。**手動確認は影響の少ないGET/読み取り専用系に留め、モデルロードを伴う検証は自動テスト（`@core/local-model`/`@core/embeddings`をモック済み）に任せる。**

## 8. まだ決めていないこと（フェーズ2.5以降で追記）

- バッチが増えて `apps/server` 側のルート数が多くなったときの、ルーティング整理方針（現状は1ファイル1リソースのフラット構成）。
- E2E的な動作確認（`emther doctor` 相当）を2プロセス構成でどう行うか。

## 9. フェーズ3（Vite SPA立ち上げ）以降の3プロセス構成

- フェーズ3.1（2026-09-19）で `apps/web`（Vite）の骨組みが立った。フェーズ3.5（2026-09-20完了）で21画面全ての移植が完了し、**通常のブラウザ確認は`vite dev`（`apps/web`）が既定になった**（詳細は10節）。
- `apps/web` の dev サーバーを起動する場合:
  ```bash
  npm run dev -w @emther/web   # 既定 http://localhost:5173（`vite`既定ポート）
  ```
  `vite.config.ts` が `/api` を `HONO_SERVER_URL`（既定 `http://127.0.0.1:${HONO_PORT ?? 8787}`）へプロキシするため、`apps/server` も同時に起動しておく必要がある（1節と同じ起動漏れの注意）。
- 3.5（画面単位移植）が進むと「この画面は `next dev` と `vite dev` のどちらで確認するか」の判断が画面ごとに発生する。判断表・移植済み画面一覧は3.5着手時にこのセクションへ追記する。

## 10. 画面ごとの確認先（3.5完了・2026-09-20。21画面全ての移植が完了）

- **21画面すべてが`apps/web`（Vite、`vite dev`）側に移植済み**: `/`（ダッシュボード）, `/help`, `/issues`（`/suggestions`へリダイレクト）, `/issues/:id`（`/suggestions/:id`へリダイレクト）, `/go/:prefix`, `/evening-review`, `/mask-check`, `/teams`, `/timeline`, `/settings`, `/people`, `/people/:id`, `/org`, `/org/thread`, `/reports`, `/growth`, `/journal`, `/suggestions`, `/suggestions/:id`, `/agents`, `/chat`。**フェーズ3.5完了に伴い、通常のブラウザ確認は`vite dev`（`apps/web`）+ `apps/server`（Hono）の2プロセス構成が既定になった**（1節・9節の「常に`next dev`」という記述はフェーズ2時点のものであり陳腐化。単一プロセス配信はフェーズ4で行う）。
- **ルートシェル・サイドピークは全画面で共通・フル機能**: `RootLayout`/`TopNav`/`SuggestionPeekRoot`（`?suggestion=`）・`timeline`自身のサイドピーク（`?issue=`）・`people`のサイドピーク（`?person=`）は全て実物のコンポーネント（`SuggestionDetailContent`/`PersonDetailContent`）で動作し、暫定プレースホルダーは0件。
- **tier4/tier5で「後続tierへの前方参照」だった暫定実装は全て解消済み**: `SuggestionPeekRoot`/`timeline`のサイドピーク（tier4 suggestionsバッチで`SuggestionDetailContent`へ差し替え）、`useRuns`（tier4 suggestionsバッチで暫定型`AgentRunLite`から`RunDetail.tsx`正本の`AgentRun`型へ差し替え）。
- **`/settings`の「データ」タブは復元・リセットが`vite dev`側では404になる**: `DataMigrationPanel`が呼ぶ`/api/settings/data/reset`・`/api/settings/data/restore`はフェーズ4まで意図的にNext側にのみ実装が残っているため（5節参照）、`apps/web`のdev proxy（`apps/server`にしか転送しない）経由では届かない。バックアップは移植済みなので動く。この2操作だけを試す場合は`next dev`（`web/`）側の`/settings`を使うこと（21画面移植完了後も残る唯一の既知の並走時の例外）。
- **旧`web/`（Next.js）側は依然として起動可能なまま残置**（フェーズ5でNext.js関連ファイルを削除するまでの間、参照実装・上記2操作の確認用として並存する）。両方を同時に立ち上げても、`apps/web`の`vite dev`と`web`の`next dev`はポートが別（既定5173/3000）なので競合しない。

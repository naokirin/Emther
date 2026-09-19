# 第2世代アーキテクチャ移行 進捗チェックリスト

関連文書: `docs/2nd_architecture.md`（方針）/ `docs/2nd_architecture/plan.md`（詳細計画・各項目の説明・完了基準はここに記載）

このチェックリストは進行管理専用。各項目の背景・完了基準・検証方法は `plan.md` の対応節を参照。**着手が確定するまで全項目未着手のまま維持する。**

- ステータス記号: `[ ]` 未着手 / `[~]` 着手中 / `[x]` 完了
- 各フェーズ完了時にコミットし、コミットメッセージまたはこのファイルの「メモ」列に完了日を残す。

## 着手記録

- 着手日: 2026-09-19
- 着手時コミット: b02abde
- 並行プロダクト作業の状況: `docs/4th_pivot/todo.md` は主要項目が完了済み（のちのち項目1件のみ残）。`docs/memo.md` の残3件は要相談扱いで停止中。大規模な衝突リスクは低いが、フェーズごとに `git log` で並行変更の有無を確認しながら進める。

## フェーズ0: 準備・基盤整備

- [x] 0.1 着手宣言（着手日・対象コミット・並行作業の凍結/継続方針を記録） — 上記「着手記録」参照
- [x] 0.2 現況再計測（import数・route数・page数を再実行し `plan.md` 1節を更新） — 2026-09-19実測値を `plan.md` に反映済み（318ファイル/669箇所等）
- [x] 0.3 codemod PoC（ts-morph、少数ファイルで `tsc`/`vitest` green を確認） — 成功。`timeline.ts`/`issue-store-types.ts` を `_poc_core/` へ移動し全参照を書き換え、`typecheck`（新規エラー0件）・`vitest run`（131ファイル/1244テスト全green）とも通過。汎用スクリプト方針は `plan.md` フェーズ1参照。実験用worktreeは後片付け済み（2026-09-19、worktree・branch共に削除）
- [x] 0.4 ネイティブ依存 externalize 検証（tsup/esbuild で transformers/onnxruntime-node/kuromoji 解決確認） — 成功。tsup/esbuildとも `external` 明示指定で3パッケージ実行時解決OK。未指定だと `Dynamic require of "child_process" is not supported` でクラッシュし、Turbopackと同種の落とし穴を再現確認。詳細は `plan.md` フェーズ0参照
- [x] 0.5 dev並走ルールのドラフト方針決定 — 詳細ドキュメント（`dev-hybrid-rules.md`）はフェーズ2.4着手時に作成する方針で確定。フェーズ0では方針決定のみ

## フェーズ1: `packages/core` 抽出

- [x] 1.1 monorepo 骨組み作成 — npm workspaces（pnpmではなく）、`web/`は物理リネームせず現状維持（着手時判断変更、理由は`plan.md`参照）。ルート`package.json`/`packages/core`骨組み/`.npmrc`・`package-lock.json`のルート移動/CI・Docker・`package-standalone.sh`の追随を実施。typecheck・test・build:standalone・`web/`内からの`npm install`/`npm run dev`で無回帰を確認（`docker build`は環境上未検証）。詳細は`plan.md`参照
- [x] 1.2 `src/lib`（83ファイル、再計測済み）棚卸し・カテゴリ分類 — Next依存あり4/persistence3/ローカルML7/agent-runtime16/ドメインストア22/汎用utility29/テストヘルパー2に分類。詳細は`plan.md`参照
- [x] 1.3 段階移設（utility → persistence → ドメインストア → agent-runtime） — 7バッチ（コミット参照: バッチ1〜7 + 残テスト2本移設）で78ファイル全てを移設完了。「Next依存あり」5ファイル（hooks/useJournalEditing/useNameCandidateConfirm/dashboard-next-actions/daily-situation）のみweb/src/libに残置。詳細・見つかった落とし穴は`plan.md`参照
- [x] 1.4 codemod 適用（バッチごとに import 置換） — 1.3と一体で実施（`.migration-tmp/move-batch.mjs`、コミット対象外）。詳細は`plan.md`参照
- [x] 1.5 Next 側 import 更新確認 — web/src全体で残る`@/lib/`参照が意図的な5ファイルのみであることを確認
- [x] 1.6 循環依存・Next混入チェック（`packages/core` に `next/*` が無いことを保証） — `next/*`・`"use client"`・`@/components`・`@/app`・`@/lib`混入0件を確認（CIへの恒久チェック追加はフェーズ2以降で検討）
- [x] 1.7 完了基準確認（全テスト green・`tsc --noEmit` エラー0） — web 523 + core 728 = 1251（移設前と同数）、typecheck両方無回帰（web側の既存5件はmainのbaseline worktreeで再現し無関係と確認済み）

## フェーズ2: Hono サーバー並走

- [x] 2.1 `apps/server` 骨組み作成（ヘルスチェック1ルート） — npm workspacesに`apps/server`（`@emther/server`）追加。`@emther/core`に`exports`（`"./*"`→`src/*.ts`）を追加しbare specifierでcore参照可能に。依存追加時に`.npmrc`の`min-release-age=7`でhono最新版が弾かれ`4.13.7`に固定した経緯あり。詳細は`plan.md`参照
- [x] 2.2 77ルートの移行順位付け（低リスク/高リスク分類） — 低リスク41・高リスク36に分類（`@core/*` import内容で機械判定）。`link-suggest`経由の`issues/link/suggest`・`themes/link/suggest`はagent起動を伴うため高リスク側に分類（要注意事項として`plan.md`に明記）。詳細は`plan.md`参照
- [x] 2.3 最初のバッチ移植 + Next側プロキシ設定（5ルート） — `glossary`/`glossary/[id]`/`vitals`/`timeline`/`id-resolve`/`knowledge/events`を`apps/server`へ移植、Next側は`web/src/lib/hono-proxy.ts`経由のフォワードに置き換え。テストも`apps/server`側へ移動（web 523→517、core 728維持、server新規15）。手動smoke test時に本番データを誤って書き換える事故が発生・即復旧済み（教訓を`plan.md`に記録、今後は必ず`EM_DATA_DIR`等を隔離すること）
- [x] 2.4 dev ハイブリッド構成確立・`dev-hybrid-rules.md` 作成（ドラフト） — `docs/2nd_architecture/dev-hybrid-rules.md`新設。現段階の並走ルール（ブラウザは常にnext dev、apps/serverは裏側、起動漏れの症状、ポート設定）を記載。移植済みルート一覧はバッチ追加のたびに更新する運用
- [x] 2.5 残りルートのバッチ移植（低リスク41・高リスク34、全て完了。例外2件は5.参照） — バッチ2完了（2026-09-19）: `teams`/`teams/[id]`/`teams/[id]/archive`/`teams/bulk`/`org/background`/`org/background/[id]`の6ルートを移植（server 8ファイル/30テスト、web 502テストで無回帰）。バッチ3完了（2026-09-19）: `reports`/`reports/[id]`/`growth/suggestions`/`growth/suggestions/[id]`/`em-self/checkins`/`em-self/reflection-notes`/`em-self/reflection-notes/[id]`の7ルートを移植（server 11ファイル/57テスト、web 480テストで無回帰）。バッチ4完了（2026-09-19）: `people`系6ルートを移植（server 12ファイル/84テスト、web 456テストで無回帰）。このバッチから手動smoke testは`curl`ではなく`safe-curl`を使用（ユーザー指摘）。バッチ5完了（2026-09-19）: `org/objectives`系5ルート + `org/strategy`の計6ルートを移植（server 14ファイル/110テスト、web 430テストで無回帰）。バッチ6完了（2026-09-19）: `journal`系6ルートを移植（server 15ファイル/143テスト、web 397テストで無回帰）。`name-candidate-response.ts`のフレームワーク非依存部分をcoreへ抽出。手動smoke testでNext.jsに無い「1リクエストの未処理例外によるプロセスクラッシュ」を発見し、フェーズ4着手前の検証項目としてリスクレジスタに追加。バッチ7完了（2026-09-19）: `settings/rules`/`themes`/`themes/[id]`/`themes/from-okr`の4ルートを移植（server 17ファイル/190テスト、web 364テストで無回帰）。**これで低リスク41ルート全ての移植が完了**。移植対象ディレクトリ外にテストが置かれているケース（`hierarchy-flow.route.test.ts`）を1件見落としていたことが判明・修正（教訓は`plan.md`参照、次バッチ以降も要注意）。高リスク バッチ1完了（2026-09-19）: `agents`/`agents/inbox`の2ルートを移植（server 18ファイル/199テスト、web 355テストで無回帰）。**agent-runtimeのwatchdog（30秒間隔の自動バッチチェック）がNext側と合わせて2プロセスで同時起動することを発見**、既存の3層二重起動ガードで大筋は許容される設計と判断し継続、フェーズ2.7の完了基準確認に実機再確認を追加項目化（詳細は`plan.md`リスクレジスタ参照）。高リスク バッチ2完了（2026-09-19）: `agents/[id]`系9ルートを移植し`agents/**`全11ルートの移植が完了（server 18ファイル/230テスト、web 327テストで無回帰）。高リスク バッチ3完了（2026-09-19）: `issues`/`issues/[id]`の2ルートを移植（server 19ファイル/253テスト、web 304テストで無回帰）。`issues/link/suggest`はcloud-chat経由のため対象外。高リスク バッチ4完了（2026-09-19）: `suggestions`系3ルートを移植（server 20ファイル/272テスト、web 290テストで無回帰）。高リスク バッチ5完了（2026-09-19）: `themes/distill`/`growth/generate`の2ルートを移植（server 22ファイル/274テスト、web 290テストで無回帰）。高リスク バッチ6完了（2026-09-19）: `journal/[id]/analyze`/`journal/batch`の2ルートを移植（server 22ファイル/279テスト、web 287テストで無回帰）。一時ディレクトリ削除を`rm -rf`から`rm-tmp`へ変更（ユーザー指摘）。高リスク バッチ7完了（2026-09-19）: `models/status`/`mask-check`/`journal/local-summarize`/`knowledge/interpretations`の4ルートを移植（server 26ファイル/293テスト、web 278テストで無回帰）。高リスク バッチ8完了（2026-09-19）: `settings/data/backup`のみ移植（server 27ファイル/294テスト、web 277テストで無回帰）。**`settings/data/reset`・`settings/data/restore`はscheduleProcessExit()がHonoプロセスだけを終了させてしまうため、フェーズ4まで意図的に未移植とする判断をした**（詳細は`plan.md`リスクレジスタ・2.7完了基準の例外事項参照）。高リスク バッチ9完了（2026-09-19）: `journal/dumps`系6ルートを移植（server 29ファイル/318テスト、web 271テストで無回帰）。**Honoの`app.route()`マウント順バグ（別々にmountしたサブアプリ間でprefixが重なると、静的パスより先にmountされた方が勝つ）を実機smoke testで発見・修正**。`GET /api/journal/dumps`が`journalRoute`の`GET /:id`に飲まれていた（`journal/local-summarize`・`themes/distill`も同じ落とし穴だったがPOST専用のため実害なし）。恒久対策として`apps/server/src/app.test.ts`（合成済みappへの直接リクエストで確認する回帰テスト）を新設。高リスク バッチ10完了（2026-09-19）: `org/objectives/parse`/`issues/link/suggest`/`themes/link/suggest`の3ルートを移植（server 32ファイル/328テスト、web 265テストで無回帰）。**これでフェーズ2.5が実質完了**（`settings/data/reset`・`restore`のみフェーズ4まで意図的に未移植）。詳細は`plan.md`参照
- [x] 2.6 Zod 導入（journal・settings/rulesの2ルートに軽量導入完了・2026-09-19） — `journal`（POST/PATCH/bulk）・`settings/rules`（PATCH）の手書きtypeof/Array.isArrayガードをZodスキーマへ置き換え。既存の「不正な型は黙ってundefined扱いにする」寛容さ・エラー文言・ステータスコードは1:1で維持（`.catch()`修飾子で実現）。DB照合やCLI固有のエラーメッセージを伴う関数（`parseSelfPersonId`等）は対象外のまま。全テスト無回帰（server 328・core 728・web 265、変更前と同数）で検証。詳細は`plan.md`参照
- [x] 2.7 完了基準確認（完了・2026-09-19） — `src/app/api/**`に実処理を持つroute.tsが残っていないことを確認（`settings/data/reset`・`restore`は意図的な例外）。加えてリスクレジスタの2項目を実機検証: ①ローカルMLモデル未ダウンロード時の例外がプロセスをクラッシュさせる事象を隔離環境で再現し、`process.on("uncaughtException"/"unhandledRejection")`＋`app.onError`で修正・再検証済み。②**agent-runtime watchdogの2プロセス二重起動を実機で実際に再現（1ミリ秒差で重複run作成を確認）**、`auto_batch_claims`テーブル（SQLite原子的クレーム）で4つの自動バッチ関数全てを修正し、同じ実機テストで解消を確認。全テスト無回帰＋新規回帰テスト追加（server 330・core 729・web 265）。詳細は`plan.md`参照

## フェーズ3: Vite SPA 立ち上げ・画面移植

- [x] 3.1 新 `apps/web`（Vite）骨組み作成（完了・2026-09-19） — Vite + React 19 + React Router（ライブラリモード、`createBrowserRouter`）+ Vitest/Testing Library。`web/`（旧Next.js）とは別ディレクトリ（`apps/web`）で並存。詳細は`plan.md`参照
- [x] 3.2 TanStack Query 導入・`usePolling` 置き換え方針確定（完了・2026-09-19） — `@emther/web`に`@tanstack/react-query`導入、`QueryClientProvider`を配線。置き換え方針を決定し、代表例`useTimeline`を移植・テストで検証。残り24フックの移植は3.5（画面単位移植）で該当画面を移すタイミングに合わせて行う。詳細は`plan.md`参照
- [x] 3.3 `useTypedSearchParams` 実装（完了・2026-09-19） — React Router `useSearchParams` + Zodの薄いラッパー。既存の`?issue=…`等の単純クエリ連動を型安全に扱う。詳細は`plan.md`参照
- [x] 3.4 21画面の移行順位付け（完了・2026-09-19） — ルートシェル（layout.tsx相当）が全画面の前提であることを確認。5ティアの移行順（help/evening-review/go/issues redirect → mask-check/teams/timeline/settings/people → org/org-thread/reports/growth → journal/suggestions → agents/chat/dashboard「/」）を決定。詳細は`plan.md`参照
- [ ] 3.5 画面単位移植（バッチ単位で都度チェック追加）
- [ ] 3.6 CSS Modules 移設
- [ ] 3.7 Vitest + Testing Library 移行
- [ ] 3.8 完了基準確認（21画面全てが新SPA側で動作）

## フェーズ4: ビルド・配布切替

- [ ] 4.1 サーバービルド確定（tsup/esbuild → `dist/server.js`）
- [ ] 4.2 クライアントビルド確定（`vite build` → `dist/client`）
- [ ] 4.3 単一プロセス配信確認
- [ ] 4.4 `scripts/emther` ランチャー切替
- [ ] 4.5 `docs/packaging.md` 更新
- [ ] 4.6 `.github/workflows/release.yml` 更新
- [ ] 4.7 `docs/docker.md` 更新
- [ ] 4.8 完了基準確認（全 `emther` サブコマンド新構成で動作、リリース tarball 動作確認）

## フェーズ5: 旧実装の除去・後片付け

- [ ] 5.1 Next.js 関連ファイル・依存の削除
- [ ] 5.2 `docs/2nd_architecture.md` の対応表・7節ステータス更新
- [ ] 5.3 最終検証（クローン→インストール→起動の一連確認）

## リスク監視メモ

（進行中に発生した問題・想定外の事象をここに追記する。`plan.md` の「リスクレジスタ」に対応するものは節番号を付記する）

- 2026-09-19（フェーズ1.1）: 作業環境に `docker` コマンドが無く、`docker compose build` の実機確認ができていない。`web/Dockerfile` / `docker-compose.yml` のパス変更は机上確認のみ。次にdocker環境がある場所で最初に確認すること。
- 2026-09-19（フェーズ2.1）: `.npmrc` の `min-release-age=7`（サプライチェーン対策）により、`apps/server` 追加時に最新 `hono@4.13.8` がインストール不可（`ETARGET`）。新規依存を追加する際は事前に公開日を確認し、7日未満なら1つ前の適格バージョンを選ぶこと。フェーズ3で追加予定の Vite / React Router / TanStack Query 等でも同じ制約に当たりうるので着手時に留意する。
- 2026-09-19（フェーズ2.3）: `apps/server` を isolation環境変数なしで起動し `curl` で手動smoke testした際、実データ（`~/.local/state/emther/data/glossary.json`）にテストエントリを書き込んでしまった（即復旧）。今後、手動でmutatingなエンドポイントを確認する際は必ず `EM_DATA_DIR`/`EM_SECURE_DATA_DIR`/`EM_BACKUP_DIR` を一時ディレクトリに向けること。
- 2026-09-19（フェーズ2.5 バッチ4）: localhost向けの手動動作確認に通常の `curl` を使っていたところ、ユーザー指摘により `safe-curl`（利用可能な環境での許可済みラッパー）へ切り替えた。以降のバッチ・`dev-hybrid-rules.md` でも `safe-curl` を使う。
- 2026-09-19（フェーズ2.5 バッチ6）: `POST /api/journal` を手動smoke testした際、ローカルMLモデル（`@huggingface/transformers`）未ダウンロードのこの作業環境で `addJournalEntryWithProfileCandidate` 内の非同期処理がキャッチされずプロセスごとクラッシュした（`try/catch`で囲んだハンドラの外、fire-and-forget的な非同期処理からの unhandled rejection と推測）。自動テストは`@core/local-model`/`@core/embeddings`をモックしているため影響なし・全green。ドメインコード自体は移設前と同じ（回帰ではない）が、**「1リクエストの未処理例外がNodeプロセス全体を落とす」**という挙動は、フェーズ4で単一プロセス配信に切り替えた際の可用性リスクになりうるため、フェーズ2.7またはフェーズ4着手前に、Hono側へのグローバルエラーハンドラ（`app.onError`）や`process.on("unhandledRejection")`の要否を検証項目として残す。ローカルMLを起動しうるエンドポイント（journal POST等）の手動smoke testは、モデル未ダウンロード環境ではGETのみに留め、POST系の検証は自動テスト（モック済み）に委ねる。→ **フェーズ2.7で解決済み**（`process.on("uncaughtException"/"unhandledRejection")`をindex.tsに追加、隔離環境で同じ手順を再実行し原因を確定・修正を確認）。
- 2026-09-19（フェーズ2.7）: agent-runtime watchdogの2プロセス二重起動リスク（フェーズ2.5 高リスク バッチ1で発見・「完全な無害性は未検証」としていた項目）を、同じ`EM_DATA_DIR`を指す2つの独立プロセスを実機起動して検証したところ、**実際に重複起動（1ミリ秒差でauto-summary runが2件作成）を確認した**。既存の3層ガード（globalThisクレーム・JSON永続化・DB run確認）はいずれも複数OSプロセス間のTOCTOUを防げないことが実証された。`packages/core/src/db.ts`に`auto_batch_claims`テーブル（SQLite UNIQUE制約による原子的クレーム）を追加し、4つの自動バッチ関数（朝サマリー・週次蒸留・週次Grow・Journal集約）全てに起動直前の最終ゲートとして組み込み、同じ実機テストで重複が解消（1件のみ作成）することを確認した。手動smoke test・実機再現テストは全て`EM_DATA_DIR`等を隔離した使い捨てディレクトリで実施し、実データへの影響なし。詳細は`plan.md`フェーズ2.7・リスクレジスタ参照。

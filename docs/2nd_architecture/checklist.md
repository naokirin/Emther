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
- [ ] 1.3 段階移設（utility → persistence → ドメインストア → agent-runtime）
- [ ] 1.4 codemod 適用（バッチごとに import 置換）
- [ ] 1.5 Next 側 import 更新確認
- [ ] 1.6 循環依存・Next混入チェック（`packages/core` に `next/*` が無いことを保証）
- [ ] 1.7 完了基準確認（全テスト green・`tsc --noEmit` エラー0）

## フェーズ2: Hono サーバー並走

- [ ] 2.1 `apps/server` 骨組み作成（ヘルスチェック1ルート）
- [ ] 2.2 77ルートの移行順位付け（低リスク/高リスク分類）
- [ ] 2.3 最初のバッチ移植 + Next側プロキシ設定
- [ ] 2.4 dev ハイブリッド構成確立・`dev-hybrid-rules.md` 作成
- [ ] 2.5 残りルートのバッチ移植（バッチ単位で都度チェック追加）
- [ ] 2.6 Zod 導入（複雑な入力ルートのみ）
- [ ] 2.7 完了基準確認（`src/app/api/**` に実処理が残っていない）

## フェーズ3: Vite SPA 立ち上げ・画面移植

- [ ] 3.1 新 `apps/web`（Vite）骨組み作成
- [ ] 3.2 TanStack Query 導入・`usePolling` 置き換え方針確定
- [ ] 3.3 `useTypedSearchParams` 実装
- [ ] 3.4 21画面の移行順位付け
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

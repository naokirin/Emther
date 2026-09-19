# 第2世代アーキテクチャ移行 詳細計画

作成日: 2026-09-19
関連文書: `docs/2nd_architecture.md`（方針・結論）/ `docs/2nd_architecture/checklist.md`（進捗管理）/ `docs/packaging.md` / `docs/docker.md`

本ドキュメントは、まだ着手判断が下っていない大規模移行に備えて、`docs/2nd_architecture.md` 7節の粗い4ステップを**実行可能な粒度のフェーズ・タスク**まで分解したものである。**このドキュメント自体の作成時点では実装には着手していない**。着手する場合はフェーズ0から開始する。

---

## 0. 前提・非目標

- 着手可否・着手タイミングは本ドキュメントの範囲外。`docs/2nd_architecture.md` 7節は「直ちに移行しない」を結論としており、着手判断は別途行う。
- 並行するプロダクト側作業（`docs/4th_pivot/`, `docs/memo.md` 等）との衝突を避けるため、着手時は直近のプロダクト作業の状況を都度確認する。
- 各フェーズは**それ単独でmainにマージ可能な状態**（テスト green・型チェック green）を維持する。フェーズの途中で止めても現行 Next.js 実装が動作し続けることを最低条件とする。
- フェーズ間の並走期間（Hono並走・dev サーバー並走）は避けられない前提とし、無理に短縮しない。

## 1. 現況の実測値（2026-09-19時点、着手判断・見積りの基準値）

| 指標 | 値 |
| --- | --- |
| `@/lib` import ファイル数 | 318 |
| `@/lib` import 箇所数 | 669 |
| `src/app/**/page.tsx` 数 | 21 |
| `src/app/api/**/route.ts` 数 | 77 |
| `src/lib/*.ts`（テスト除く） | 82 |
| `src/components/**/*.tsx` | 123 |

着手時点で再計測し、この表を更新する（増減が見積りに直結するため）。

---

## フェーズ0: 準備・基盤整備

着手判断が出た直後、コード変更前に行う。

- **0.1 着手宣言**: 着手日・対象コミット・並行するプロダクト作業の凍結/継続方針を `checklist.md` に記録する。
- **0.2 現況再計測**: 本ドキュメント1節の表を再実行・更新する。
- **0.3 codemod PoC**: `ts-morph` で `@/lib/foo` → 新パスへの import 書き換えを、影響ファイル数の少ないサブセット（例: `src/lib/*-store.ts` を参照する数ファイル）で試し、`tsc --noEmit` と `vitest run` の両方が通ることを確認する。本番適用前に手順をスクリプト化する。
  - **検証済み（2026-09-19）**: `timeline.ts` / `issue-store-types.ts` の2ファイルで成功。`typecheck` 新規エラー0件、`vitest run` 全131ファイル/1244テストgreen。汎用スクリプト方針（`web/scripts/poc-codemod.ts` 相当、実験worktreeに残存）:
    1. `ts-morph` の `Project`（tsConfigFilePath指定）で全ソースを読み込む
    2. 全 `ImportDeclaration`/`ExportDeclaration` の `moduleSpecifierValue` が対象パスと一致したら `setModuleSpecifier` で書き換え（`import type`/`export type ... from` も同APIでカバー）
    3. `forEachDescendant` で動的 `import("@/lib/...")` の `CallExpression` も同様に書き換え
    4. 対象ファイルは `sourceFile.move(newPath)` で物理移動（相対import解決も自動調整）
    5. `project.save()`
  - **落とし穴**: `vi.mock("@/lib/xxx", ...)` の文字列引数は上記スキームでは検出されないため、本番適用時は `vi.mock` 呼び出しの第一引数も走査対象に追加する必要がある。
  - フェーズ1.4では、このスクリプトの `TARGETS` をフェーズ1.2のカテゴリ別ファイルリストに差し替え、カテゴリ単位（utility→persistence→ドメインストア→agent-runtime）でバッチ実行する。
- **0.4 ネイティブ依存 externalize 検証**: `tsup` または `esbuild` の最小構成プロジェクトを作り、`@huggingface/transformers` / `onnxruntime-node` / `kuromoji` が**ビルド後に実際に import 解決される**ことを確認する（2nd_architecture.md 3.5節が指摘する既知の落とし穴の再発確認）。ここで解決できない場合、Phase 4 全体の前提が崩れるため、フェーズ0で必ず潰す。
  - **検証済み（2026-09-19）**: tsup・esbuildとも `external: ["@huggingface/transformers", "onnxruntime-node", "kuromoji"]`（CLIフラグ/config両方）で3パッケージとも実行時解決に成功（kuromoji形態素解析・transformersの`pipeline()`取得・onnxruntime-nodeの`InferenceSession`取得を確認）。
  - **重要な注意**: tsupはデフォルトで`package.json`の`dependencies`を自動external化するが、`onnxruntime-node`のようにtransitive依存のみのパッケージは自動対象外の可能性があるため、**本番では3パッケージ全部を`external`配列に明示列挙する**（自動判定に依存しない）。
  - **落とし穴の再現確認**: external指定なしでesbuild `--bundle` すると、ビルド自体は成功（1.7MB）するが実行時に `Dynamic require of "child_process" is not supported` でクラッシュ（transformers→sharp→detect-libcの動的require）。これはNext.js/Turbopackで踏んだ既知問題と同種であり、「ビルドが通る」≠「実行時に解決される」という教訓がtsup/esbuild移行後も引き続き有効。
  - **推奨設定**:
    ```ts
    // tsup.config.ts
    export default defineConfig({
      entry: ["src/server.ts"],
      format: ["esm"],
      platform: "node",
      target: "node20",
      external: ["@huggingface/transformers", "onnxruntime-node", "kuromoji"],
    });
    ```
  - **未検証**: 実モデル推論の完全実行（HFハブからのダウンロードを伴う`pipeline()`呼び出し）、Linux/x64以外の環境。フェーズ4本番導入時に再確認が必要。
  - **結論**: Phase 4着手の前提（tsup/esbuild切替で同種の問題が再発しない）は成立。ただし「ビルド後に`node dist/server.js`実行して3パッケージが実際に解決されるか」を配布前チェックのCIステップとして残す（4.8の完了基準に含める）。
- **0.5 並走ルールのドラフト**: 6.2節のハイブリッド開発体験（`next dev` と Hono/Vite dev サーバーの併存期間）について、「どちらの dev サーバーで確認すべきか」の判断ルールを `docs/2nd_architecture/dev-hybrid-rules.md`（フェーズ2着手時に作成）としてドラフトする方針だけここで決める。

**完了基準**: 0.3・0.4 の PoC が両方成功し、`checklist.md` に記録されている。

---

## フェーズ1: `packages/core` 抽出

対象: 現行 `web/src/lib`（83ファイル、2026-09-19再計測。1節の82は前回計測値）と、Next Route Handler から参照されている型・ドメインロジック。

- **1.1 monorepo 骨組み（完了・2026-09-19）**: npm workspaces 化。ルート `package.json`（`"workspaces": ["web", "packages/*"]`）+ `packages/core`（`package.json`/`tsconfig.json`/`src/index.ts`）を新設。
  - **着手時の判断変更**: 当初案の pnpm・`apps/web` への物理リネームは見送り、**npm workspaces** かつ **`web/` はディレクトリ名を変えず現状維持**とした（ユーザー判断、2026-09-19）。理由: pnpm 導入は CI・ローカル環境への追加インストール要求とロックファイル形式変更を伴い、フェーズ1（core分離）の本質的な目的に対して過剰コスト。`apps/web` への物理リネームも同様に、フェーズ3（Vite SPA立ち上げ）で `apps/web`（新）を作る際にまとめて整理する方が二度手間にならない。`apps/server` の骨組みも同じ理由でフェーズ2に先送り。
  - **実施内容**: ルート `package.json`（`workspaces`, `allowScripts`）/ `packages/core/{package.json,tsconfig.json,src/index.ts}` 新設。`.npmrc` と `package-lock.json` を `web/` からルートへ移動。`web/tsconfig.json` に `"@core/*": ["../packages/core/src/*"]` を追加。`web/next.config.ts` に `transpilePackages: ["@emther/core"]` と `outputFileTracingRoot`（ホイストされた `node_modules` をトレース対象に含めるため）を追加。`web/package.json` の `dependencies` に `"@emther/core": "*"` を追加し、ワークスペース内でのみ意味を持つ `allowScripts` はルート側に一本化（`web/package.json` からは削除。`npm install` 実行時に `allowScripts in workspace web is ignored. Move the field to the project root package.json.` という警告で裏付け済み）。
  - **配布まわりの追随**: `docker-compose.yml`（`context: ./web` → `context: .` + `dockerfile: web/Dockerfile`）、`web/Dockerfile`（ビルドコンテキストがルートになったため `COPY` パスを `packages/core/package.json` 追加・`web/` プレフィックス付与に調整。`npm run build` → `npm run build -w web`）、`.dockerignore`（`web/.dockerignore` からルートへ移動しパスをルート相対に調整）、`.github/workflows/ci.yml`（`working-directory: web` の defaults を廃止し `cache-dependency-path: package-lock.json` + `npm run <script> -w web` に統一。typecheck ジョブに `npm run typecheck -w @emther/core` を追加）、`.github/workflows/release.yml`（`cache-dependency-path` をルート `package-lock.json` に変更）、`scripts/package-standalone.sh`（依存インストールを `$WEB_DIR` からルート（`$ROOT`）での `npm ci`/`npm install` に変更。native 依存コピー元を `$WEB_DIR/node_modules` → 見つからなければ `$ROOT/node_modules` にフォールバック）を更新。
  - **検証済み（2026-09-19）**: `npm run typecheck -w web`（既存の無関係な5件の型エラーのみ。`main`ブランチの baseline worktree で同一エラーを再現し、本作業由来でないことを確認済み）、`npm run test -w web`（133ファイル/1251テスト全green）、`npm run typecheck -w @emther/core`（エラー0）、`npm run build:standalone -w web`（webpackコンパイルは成功。型エラーで停止するのは上記と同じ既存問題）、`web/` ディレクトリ内から直接 `npm install` / `npm run dev` を実行してもワークスペースルートを正しく検出し `next dev` が200を返すことを確認。**未検証**: `docker build`（このセッションに docker コマンドが無いため実機確認できていない。Dockerfile 変更の妥当性はパスの机上確認のみ）。フェーズ2以降で実際に `docker compose build` を通すことをタスク化しておく。
- **1.2 棚卸し（完了・2026-09-19）**: `src/lib` 83ファイル（テスト・`.test.ts(x)`除く）を以下のカテゴリに分類した。分類根拠: 全ファイルを `next/*` import と `@/components` import の有無で機械的にスクリーニングし（`grep`実測）、残りは役割（永続化呼び出しの有無・`*-store` 命名・純粋関数か否か）で判定。
  - **Next 依存あり（`core` 化しない。4ファイル）**: `hooks.ts`（`next/navigation` 直接import + `@/components` 依存）, `useJournalEditing.ts`（`"use client"`、UI状態フック）, `useNameCandidateConfirm.tsx`（`"use client"` + `@/components/NameCandidateConfirmDialog` 依存）, `dashboard-next-actions.ts`（`next` import はないが `@/components/RunDetail` `@/components/PendingAgentStartNotice` に依存するため同様に不可）。
  - **persistence（3）**: `persistence.ts`, `db.ts`, `state-archive.ts`（`fs` 直接操作によるバックアップ/アーカイブで永続化層と同格）。
  - **ローカル ML（7）**: `embeddings.ts`, `local-model.ts`, `local-summarizer.ts`, `mask-check.ts`, `mask-check-morph.ts`, `mask-check-lexicon.ts`, `model-loader.ts`。
  - **agent-runtime（16）**: `cloud-chat.ts`（Agent CLI を直接 spawn する点で agent-runtime と同型）, `agent-runtime/` 配下15ファイル（`agent-catalog.ts`, `batch-context-blocks.ts`, `cli-runners/{agy,claude,core,cursor,index}.ts`, `context-blocks.ts`, `extraction.ts`, `index.ts`, `journal-batch-window.ts`, `run-actions.ts`, `scheduled-tasks.ts`, `store.ts`, `types.ts`）。
  - **ドメインストア（22）**: `em-growth-store.ts`, `em-self-store.ts`, `glossary-store.ts`, `issue-store.ts`, `issue-store-types.ts`, `journal-store.ts`, `knowledge-store.ts`, `observation-dump-store.ts`, `observation-dump-types.ts`, `observation-dump-mapping-types.ts`, `org-context-store/{backgrounds,index,objectives,strategy,teams}.ts`, `people-directory.ts`, `person-concern-ack-store.ts`, `person-evaluation-store.ts`, `report-store.ts`, `settings-store.ts`, `suggestion-store.ts`, `theme-store.ts`。
  - **汎用 utility（29）**: `agent-knowledge-tools.ts`, `daily-situation.ts`, `daily-trends.ts`, `dashboard-day-phase.ts`, `id-prefix.ts`, `id-resolve.ts`, `journal-analysis.ts`, `journal-consult-index.ts`, `journal-date-parser.ts`, `link-suggest.ts`, `local-chat-presets.ts`, `mask-check-types.ts`, `name-candidate-confirmation.ts`, `name-candidate-detect.ts`, `objective-progress.ts`, `observation-dump-actions.ts`, `observation-dump-normalize.ts`, `observation-dump-parse.ts`, `observation-dump-profiles.ts`, `okr-parse.ts`, `origin-trace.ts`, `people-hub.ts`, `person-honorific.ts`, `reference-lookup.ts`, `related-context.ts`, `strategy-trail.ts`, `timeline.ts`, `types.ts`, `vitals.ts`。**`types.ts` は他の大半のファイルから参照される共有型定義のため、1.3の「utility」波の中でも最優先で移す。**
  - **テストヘルパー（2、独自カテゴリ）**: `test-helpers/{api-route,store-env}.ts`。単独では移設せず、参照元（ドメインストア群）のテストと同じバッチで移す。
  - **移設順序への反映**: 1.3 の「utility → persistence → ドメインストア → agent-runtime」に対し、ローカル ML は他カテゴリへの依存が薄いため utility 波と同時か直後に移してよい。`observation-dump-*` 系・`mask-check-*` 系は相互依存が強いため、まとまったバッチとして扱う。
- **1.3 段階移設**: 依存の少ない utility → persistence → ドメインストア → agent-runtime の順で `packages/core` に移す。1回の移設単位は「他から参照されるファイル1〜数本」に留め、都度 `tsc --noEmit` + `vitest run` を通す。
- **1.4 codemod 適用**: 0.3 で確立した ts-morph スクリプトで `@/lib/...` の import 先を新パス（例 `@core/...`）へ一括置換。1.3 の移設バッチごとに実行し、都度差分をレビューする。
- **1.5 Next 側 import 更新の確認**: `src/app/api/**` と `src/app/**/page.tsx` からの import が新パスに揃っていることを確認する。
- **1.6 循環依存・Next混入チェック**: `packages/core` 配下から `next/*` や `"use client"` を import しているファイルが無いことを grep で保証する（CI に恒久チェックとして追加できるとよい）。
- **1.7 完了基準**: 全テスト green、`tsc --noEmit` エラー0、`packages/core` に Next 依存がゼロであることの確認コマンドが再現可能な形で残っている。

---

## フェーズ2: Hono サーバー並走

対象: 現行 `src/app/api/**` の77ルート。

- **2.1 `apps/server` 骨組み**: Hono + `@hono/node-server` の最小サーバーを追加。まずヘルスチェック用の1ルートのみ。
- **2.2 移行順位付け**: 77ルートを「単純な CRUD（低リスク）」「複雑な入力・エージェント連携（高リスク）」に分類し、低リスクから移す順序を決める。
- **2.3 最初のバッチ移植**: 数ルートを Hono に実装し、Next 側からは同一パスへの内部プロキシ（または該当ルートの `route.ts` を Hono へのフォワードに置き換える）で並走させる。
- **2.4 dev ハイブリッド構成の確立**: `next dev`（既存画面）と Hono dev サーバー（別ポート）の同時起動、プロキシ設定を整備し、`docs/2nd_architecture/dev-hybrid-rules.md` として文書化する（0.5 のドラフトを本文書化）。
- **2.5 残りルートの段階移植**: 2.2 の分類順に、バッチ単位（目安: 5〜10ルート/バッチ）で移植・検証を繰り返す。
- **2.6 Zod 導入**: 全ルート一律ではなく、journal 投稿・settings 更新等の複雑な入力を受けるルートに絞って導入する（2nd_architecture.md 3.4節の方針どおり）。
- **2.7 完了基準**: `src/app/api/**` に実処理を持つ `route.ts` が残っておらず（全て Hono 側の呼び出しに委譲、または削除済み）、既存の API 契約（レスポンス形状）が変わっていないことをテストで確認できる。

---

## フェーズ3: Vite SPA 立ち上げ・画面移植

対象: 現行 `src/app/**/page.tsx`（21画面）+ `src/components`（123ファイル）。

- **3.1 `apps/web`（新）骨組み**: Vite + React 19 + React Router（ライブラリモード）で新規 SPA を用意。既存 `apps/web`（旧 Next.js）とは別ディレクトリで並存させる。
- **3.2 サーバー状態層**: TanStack Query を導入し、`hooks.ts` の `usePolling` 群を置き換える方針を確定する（1:1 移植か、invalidate 戦略を見直すかを最初に決める）。
- **3.3 型安全クエリパラメータ**: `useTypedSearchParams`（Zod ラッパー）を実装し、`/chat?run=…` 等のクエリ連動箇所で使う。
- **3.4 移行順位付け**: 21画面を依存の少ないもの（他画面から埋め込まれていない独立画面）から順に並べる。
- **3.5 画面単位移植 + 並走ルール運用**: 1画面ずつ移植し、「その画面は旧 Next 側 / 新 Vite 側のどちらで確認するか」を都度 `dev-hybrid-rules.md` に反映しながら進める。
- **3.6 スタイル移設**: `*.module.css` をそのまま新 `apps/web` に移す（CSS Modules 継続のため変換コストは小さい想定）。
- **3.7 テスト移行**: Vitest + Testing Library のテストファイルを新 `apps/web` 配下に移す。Next 非依存で書かれているため書き直しは基本不要（2nd_architecture.md 6.3節の想定どおりであることをここで実証する）。
- **3.8 完了基準**: 21画面全てが新 `apps/web`（Vite SPA）側で動作し、旧 Next.js 側の同等画面は削除可能な状態になっている。

---

## フェーズ4: ビルド・配布切替

対象: `scripts/emther`, `docs/packaging.md`, `.github/workflows/release.yml`, `docs/docker.md`。

- **4.1 サーバービルド確定**: フェーズ0.4 の PoC を本番の `apps/server` 構成に適用し、`tsup`（または `esbuild`）で `dist/server.js` を生成する設定を確定する。
- **4.2 クライアントビルド**: `vite build` → `dist/client` を確定する。
- **4.3 単一プロセス配信**: Hono が `dist/client` の静的配信と `/api/*` を同一プロセス・同一ポートで扱うことを確認する。
- **4.4 ランチャー切替**: `scripts/emther` の起動対象を `next start` → `node dist/server.js` に変更する。PID 管理・`--port`/`--host` 引数・XDG パスは現行仕様を維持する。
- **4.5 `docs/packaging.md` 更新**: 「standalone ビルドは webpack」「Turbopack の serverExternalPackages 欠落」といった Next 固有の記述を、tsup/esbuild 前提の内容に書き換える。
- **4.6 CI 更新**: `.github/workflows/release.yml` のビルドステップを新構成に合わせる。
- **4.7 Docker 更新**: `docs/docker.md` を新構成（フル `node_modules` + `node dist/server.js`）に合わせて更新する。
- **4.8 完了基準**: `emther install` / `start` / `restart` / `stop` / `status` / `doctor` / `backup` / `restore` の全コマンドが新構成で動作し、リリース tarball を新規マシン想定でインストール〜起動まで確認できる。

---

## フェーズ5: 旧実装の除去・後片付け

- **5.1** Next.js 関連ファイル・依存の削除（`next.config.ts`, `eslint-config-next`, 旧 `apps/web`（Next版）ディレクトリ等）。
- **5.2** `docs/2nd_architecture.md` の対応表（4節）・7節のステータスを「移行完了」に更新。
- **5.3** 最終検証: 新規クローン→インストール→起動の一連の動作確認（README の手順をなぞる）。

**完了基準**: リポジトリ内に Next.js への参照が残っていない（`package.json` の依存、import、ドキュメントの現状記述を含む）。

---

## リスクレジスタ

| リスク | 影響フェーズ | 対応 |
| --- | --- | --- |
| `@/lib` import 置換規模（318ファイル・669箇所）の codemod 失敗・取りこぼし | 1 | 0.3 で PoC 済ませ、バッチ単位で `tsc`/`vitest` 検証を繰り返す |
| ネイティブ依存（transformers/onnxruntime-node/kuromoji）の externalize 再発 | 0, 4 | 0.4 で先行 PoC。フェーズ4着手前に再確認必須 |
| dev サーバー並走期間の判断負荷（6.2節） | 2, 3 | `dev-hybrid-rules.md` を都度更新し、判断を文書に寄せる |
| プロダクト側作業（4th_pivot等）との差分競合 | 全体 | 着手時に直近のプロダクト作業状況を確認し、フェーズ単位でmainに追従する |
| 配布関連ドキュメント（packaging.md/docker.md/release.yml）の更新漏れ | 4 | 4.5〜4.7 を独立タスク化し、チェックリストに明示 |
| SQLite（`node:sqlite`）・JSON atomic write 等の永続化境界の意図しない変更 | 1 | 移設は「配置場所の変更」のみに限定し、実装ロジックは変更しないことをレビュー基準にする |

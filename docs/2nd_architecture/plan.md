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
- **1.3 段階移設（完了・2026-09-19）**: 依存の少ない utility → persistence → ドメインストア → agent-runtime の順で7バッチに分けて `packages/core` に移設し、バッチごとに `tsc --noEmit` + `vitest run`（web・core両方）を通してコミットした。移設可能と判定した78ファイル全てに加え、命名規約が`<key>.test.ts`と一致せずcodemodの自動検出から漏れていたテスト2本（`agent-runtime.test.ts`、`org-context-store.test.ts`、`link-suggest.live-diagnose.test.ts`）も手動で追従移設した。
  - **実施したcodemod（1.4と一体で実施）**: `.migration-tmp/move-batch.mjs`（コミット対象外、`.gitignore`に追加）という ts-morph ベースのバッチ移設スクリプトを新規に書き起こした（0.3 PoC時点の実験worktreeは削除済みで再利用不可だったため）。1バッチ＝キー配列を渡すと、(1) 全プロジェクトを横断して該当ファイルへの参照（`import`/`export`宣言・動的`import()`・`vi.mock`/`vi.doMock`・`typeof import()`型・`vi.importActual`引数を含む全 `StringLiteral` ノードを網羅的に走査）を新しい specifier（移動先が web 側から参照されるなら `@core/X`、core 側からなら相対パス）に書き換え、(2) `sourceFile.move()` で物理移動する。移動直後には「直前のバッチ時点ではまだwebに残る前提で書かれた`@core/X`」を相対pathに直す自己参照正規化パス（`.migration-tmp/self-fix.mjs`としても独立実行可能）も追加した。
  - **見つかった落とし穴（今後同種の移設をする場合の教訓）**:
    1. `vi.mock`以外の呼び出し形（`vi.doMock`、`vi.importActual`の引数、`typeof import("...")`型）は個別のCall式パターン列挙では漏れる。`StringLiteral`ノードを型に関係なく網羅的に走査する方式に直した。
    2. 一度coreへ移設したファイルが、後続バッチで別ファイルから再度参照されると、直前のバッチ実行時点の「まだwebに残る」前提で書かれた`@core/X`エイリアスが、移設後は本来core内部の相対import(`./X`)であるべきなのに残る。移動直後の自己参照正規化パスが必要（本文中の説明のとおり）。
    3. 本番コードの依存グラフだけを見て移設順序を決めると、**テストファイル固有の追加依存**（本体は依存しないがテストだけが動的importする関係）を見落とす。例: `journal-store.test.ts`は`journal-store.ts`が依存しない`journal-analysis`/`journal-consult-index`（agent-runtime依存）を動的importしていたため、バッチ2では`journal-store.ts`のみ移設し`journal-store.test.ts`は一時的にweb側へ残置、agent-runtime・journal-analysis等が揃ったバッチ5で追従移設した。同様に`mask-check-lexicon.test.ts`（バッチ1）が`mask-check.ts`（同バッチのため急遽追加）を動的importしていた例もある。
    4. web側の vitest（`web/vitest.config.mts`）は `@` エイリアスを手動定義しており、tsconfigの`paths`を自動では見ない。`@core`エイリアス追加を忘れてバッチ1適用直後に web 側97ファイルのテストが解決エラーで落ちた（`resolve.alias`に`@core`を追加して解消）。
    5. ディレクトリ内ファイル（`agent-runtime/*`, `org-context-store/*`）は相互に相対importを使っており、本番コードの`@/lib/`importだけを見た依存グラフでは検出できない依存が隠れる。グラフ解析時に相対importも解決対象に含めて修正した上で、これらのディレクトリは常に丸ごと1バッチで移設した。
  - **`packages/core`側のテスト実行環境**: `packages/core/vitest.config.mts`・`packages/core/package.json`の`test`/`test:watch`スクリプトを新設（Next非依存、`environment: "node"`のみ）。CIの`test`ジョブに`npm test -w @emther/core`を追加。
- **1.4 codemod 適用（完了・1.3と同時実施）**: 上記の通り、1.3の各バッチ実行に組み込んで実施した。個別の独立ステップとしては行っていない（バッチごとに移設と参照書き換えを同時に検証する方がリスクが低いと判断）。
- **1.5 Next 側 import 更新の確認（完了・2026-09-19）**: `web/src`全体を`grep`し、残る`"@/lib/X"`参照が全て意図的に web 側へ残した5ファイル（`hooks`, `useJournalEditing`, `useNameCandidateConfirm`, `dashboard-next-actions`, `daily-situation`）宛てのみであることを確認した。それ以外の`@/lib/...`参照は0件。
- **1.6 循環依存・Next混入チェック（完了・2026-09-19）**: `packages/core/src`配下を`grep`し、`next/*` import・`"use client"`・`@/components`・`@/app`・残存`@/lib`（コメント2件のみ、コード側の実害なし。文言修正済み）が0件であることを確認した。CIへの恒久チェック追加は未実施（フェーズ2以降で`apps/server`骨組み構築時にあわせて追加を検討）。
- **1.7 完了基準（達成・2026-09-19）**: 全テストgreen（web 523 + core 728 = 移設前と同じ合計1251）、`tsc --noEmit`エラー0（web・core両方。web側に残る5件は本移設と無関係の既存不具合で、`main`のbaseline worktreeで再現し本作業由来でないことを確認済み）、`packages/core`にNext依存ゼロを上記1.6のコマンドで確認済み。確認コマンド: `grep -rl 'from "next\|"use client"\|"@/components\|"@/app\|"@/lib' packages/core/src`（実行結果0件、コメントの誤検知を除く）。

---

## フェーズ2: Hono サーバー並走

対象: 現行 `src/app/api/**` の77ルート。

- **2.1 `apps/server` 骨組み（完了・2026-09-19）**: npm workspaces に `apps/server`（`@emther/server`）を追加。Hono + `@hono/node-server` の最小サーバー（`src/index.ts`）と、ヘルスチェック用の1ルート（`GET /api/health`）を実装。`packages/core/package.json` に `exports`（`"."`/`"./*"` を `src/*.ts` にマップ）を追加し、`apps/server` からは `@emther/core/xxx` の bare specifier でサブパスをそのまま import できるようにした（web側の `@core/*` tsconfig pathsエイリアスとは別方式。パッケージ解決なので `tsx`/`vitest`/将来の `tsup` いずれでもエイリアス設定なしに解決できる）。ルート `package.json` の `workspaces` に `apps/*` を追加。
  - **依存追加時の注意**: このリポジトリの `.npmrc` は `min-release-age=7`（公開から7日未満のパッケージはインストール禁止、サプライチェーン対策）。着手時点の最新 `hono@4.13.8` は7日未満で弾かれた（`npm install --legacy-peer-deps` でも `ETARGET` で失敗）ため、直近の適格版 `hono@4.13.7`（`@hono/node-server` は `2.1.1` で適格）に固定した。ERESOLVE時のエラーメッセージが `Found: hono@undefined` という分かりにくい表示になる点も記録しておく（原因は日齢フィルタで候補が0件になること）。
  - **動作確認**: `npm run dev -w @emther/server` で `http://127.0.0.1:8787` にlisten、`curl /api/health` `/api/timeline` `/api/glossary`（POST含む）で疎通確認済み。
- **2.2 移行順位付け（完了・2026-09-19）**: `web/src/app/api/**/route.ts` 全77ファイルを `@core/*` importの中身で機械的にスクリーニングし、以下の基準で分類した。
  - **低リスク（41）**: agent-runtime起動（`agent-runtime/*`, `cloud-chat.ts`経由）・ローカルMLロード/推論（`embeddings`, `mask-check*`, `local-summarizer`, `model-loader`の同期的利用）・プロセス再起動（`state-archive`のbackup/reset/restore）のいずれにも該当しない単純CRUD。
    `em-self/checkins`, `em-self/reflection-notes`, `em-self/reflection-notes/[id]`, `glossary`, `glossary/[id]`, `growth/suggestions`, `growth/suggestions/[id]`, `id-resolve`, `journal`, `journal/[id]`, `journal/[id]/archive`, `journal/[id]/no-action-needed`, `journal/bulk`, `journal/search`, `knowledge/events`, `org/background`, `org/background/[id]`, `org/objectives`, `org/objectives/[id]`, `org/objectives/[id]/key-results`, `org/objectives/[id]/key-results/[krId]`, `org/objectives/import`, `org/strategy`, `people`, `people/[id]`, `people/[id]/concern-acks/[issueId]`, `people/[id]/evaluation-logs`, `people/[id]/evaluation-logs/[logId]`, `people/[id]/merge`, `reports`, `reports/[id]`, `settings/rules`（`model-loader`の`ensureLocalModels()`を呼ぶが`void`で発火のみ・待ち受けなしのため低リスク側に分類）, `teams`, `teams/[id]`, `teams/[id]/archive`, `teams/bulk`, `themes`, `themes/[id]`, `themes/from-okr`, `timeline`, `vitals`。
  - **高リスク（36）**: 上記のいずれかに該当。`agents/**`（11ルート全て）, `growth/generate`, `issues`, `issues/[id]`, `issues/link/suggest`（`link-suggest.ts`が`cloud-chat`経由でagent起動するため高リスク側。低リスクに見えやすいが要注意）, `journal/[id]/analyze`, `journal/batch`, `journal/dumps`, `journal/dumps/[id]`, `journal/dumps/[id]/accept`, `journal/dumps/[id]/parse`, `journal/dumps/preview`, `journal/dumps/profiles`, `journal/local-summarize`, `knowledge/interpretations`, `mask-check`, `models/status`, `org/objectives/parse`（`okr-parse.ts`が`cloud-chat`経由でagent起動）, `settings/data/backup`, `settings/data/reset`, `settings/data/restore`, `suggestions`, `suggestions/[id]`, `suggestions/[id]/memo`, `themes/distill`, `themes/link/suggest`（`issues/link/suggest`と同じ理由）。
  - **移行順序**: 低リスクをバッチ単位（5〜10ルート）で先に移し、`apps/server`側のパターン（Honoルーティング・テスト・プロキシ）を安定させてから高リスク（agent-runtime起動を伴うもの）に着手する。高リスク側は「子プロセスspawnが2プロセス構成でも同様に動くか」の検証が追加で必要になる。
- **2.3 最初のバッチ移植（着手・2026-09-19、5ルート完了）**: 低リスクのうち依存が薄い5ルートを最初のバッチとして移植した: `glossary`（`GET`/`POST`）, `glossary/[id]`（`GET`/`PATCH`/`DELETE`）, `vitals`（`GET`）, `timeline`（`GET`）, `id-resolve`（`GET`）, `knowledge/events`（`GET`）。実処理を `apps/server/src/routes/{glossary,vitals,timeline,id-resolve,knowledge-events}.ts` に実装し、対応する `web/src/app/api/**/route.ts` は `web/src/lib/hono-proxy.ts` の `proxyToHono`（標準 `Request`/`Response` をそのまま `fetch` でフォワードする薄い関数。POST等のbody転送には Node fetch の `duplex: "half"` が必要）への委譲に置き換えた。
  - **テストの移動方針**: 移植したルートの契約テストは `apps/server/src/routes/*.test.ts` に移設した（Hono インスタンスの `.request()` を直接呼ぶ形。`packages/core/src/test-helpers/store-env` の isolated env パターンを流用）。Next側に残っていた同等テスト4本（`vitals`/`timeline`/`id-resolve`/`knowledge/events`の`route.test.ts`）は削除し、代わりに `web/src/lib/hono-proxy.test.ts`（`fetch`をモックし、メソッド・パス・クエリ・bodyの転送を検証する1本）を追加した。`glossary`はNext側に既存テストが無かったため純増（`apps/server`側に新規6ケース追加）。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（6ファイル/15テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ、`main`のbaseline再現確認済み）、`npm test -w web`（517テスト green。移植前523 − 削除9 + 新設3 = 517で一致）、`npm test -w @emther/core`（728テスト green、無回帰）。
  - **⚠️ 手動smoke test時の事故と教訓**: `apps/server`を`EM_DATA_DIR`等のisolation環境変数なしで起動して`curl`で動作確認した際、実際のユーザーデータ（`~/.local/state/emther/data/glossary.json`）に`curl -X POST`のテストエントリを書き込んでしまった。直後に`deleteGlossaryEntry`で削除し復旧したが、**今後手動でmutatingなエンドポイントをcurl等で確認する際は必ず`EM_DATA_DIR`/`EM_SECURE_DATA_DIR`/`EM_BACKUP_DIR`を一時ディレクトリに向けてから行うこと**（自動テストは`setupIsolatedStoreEnv`で担保されているが、手動確認はこのガードの外にある）。
- **2.4 dev ハイブリッド構成の確立（ドラフト完了・2026-09-19）**: `docs/2nd_architecture/dev-hybrid-rules.md` を新設。現段階（フェーズ2）でのルール骨子: ブラウザから見るのは常に `next dev`、`apps/server`はNext Route Handlerからプロキシされる裏側のプロセス、移植済みルートの実装修正は`apps/server`側で行う、起動漏れ時の症状（プロキシ先500）、ポート設定（`HONO_PORT`/`HONO_HOST`/`HONO_SERVER_URL`）を記載。移植済みルート一覧・判断表はバッチが増えるたびに更新する運用とした。
- **2.5 残りルートの段階移植（着手・2026-09-19、バッチ2完了）**: 低リスク残36ルートから、`org-context-store`を共通の依存とするクラスタを2つ目のバッチとして移植した: `teams`（`GET`/`POST`）, `teams/[id]`（`PATCH`/`DELETE`）, `teams/[id]/archive`（`POST`）, `teams/bulk`（`POST`）, `org/background`（`GET`/`POST`）, `org/background/[id]`（`PATCH`/`DELETE`）。実処理を `apps/server/src/routes/{teams,org-background}.ts` に実装（1ファイル1リソースの粒度を保ちつつ、同一リソースの複数エンドポイントは1つのHonoサブルーターにまとめた。1.3のディレクトリ単位移設の教訓を踏襲）。対応するNext側6ファイルは`proxyToHono`への委譲に置き換え、既存テスト6本（計15ケース）は`apps/server/src/routes/{teams,org-background}.test.ts`へ移設した。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（8ファイル/30テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（502テスト green。502 = 517 − 15）、手動smoke testは今回`EM_DATA_DIR`等を一時ディレクトリに向けた上で実施し、本番データへの誤書き込みは無し（2.3の教訓を反映）。
  - **残低リスク**: 36 − 6 = 30ルート。
- **2.5 バッチ3（完了・2026-09-19）**: 低リスク残30ルートから、単純ストアCRUDのクラスタを移植した: `reports`（`GET`/`POST`）, `reports/[id]`（`PATCH`）, `growth/suggestions`（`GET`）, `growth/suggestions/[id]`（`PATCH`）, `em-self/checkins`（`GET`/`POST`）, `em-self/reflection-notes`（`GET`/`POST`）, `em-self/reflection-notes/[id]`（`PATCH`）。実処理を `apps/server/src/routes/{reports,growth-suggestions,em-self}.ts` に実装（`em-self`は`checkins`/`reflection-notes`の2リソースを1ファイルにまとめた。ディレクトリが近く依存も薄いため）。対応するNext側7ファイルは`proxyToHono`への委譲に置き換え、既存テスト5本はapps/server側へ移設。`growth/suggestions`系はNext側に既存テストが無かったため新規6ケースを追加した。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（11ファイル/57テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（480テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。手動smoke testは`EM_DATA_DIR`等を一時ディレクトリへ向けて実施し、本番データへの誤書き込みは無し。
  - **残低リスク**: 30 − 7 = 23ルート。
- **2.5 バッチ4（完了・2026-09-19）**: 低リスク残23ルートから、`people-hub`/`people-directory`/`person-evaluation-store`/`person-concern-ack-store`をまたぐpeopleクラスタ6ルートを移植した: `people`（`GET`/`POST`）, `people/[id]`（`GET`/`PATCH`/`DELETE`）, `people/[id]/merge`（`POST`）, `people/[id]/concern-acks/[issueId]`（`PATCH`）, `people/[id]/evaluation-logs`（`GET`/`POST`）, `people/[id]/evaluation-logs/[logId]`（`PATCH`）。実処理を `apps/server/src/routes/people.ts` に1ファイルへまとめて実装（1リソースに複数のネストしたサブリソースがぶら下がる構造のため、teams同様1ファイル1リソースの粒度を維持）。対応するNext側7ファイルは`proxyToHono`への委譲に置き換え、既存テスト5本はapps/server側へ移設。`people/[id]/evaluation-logs`（ネストしないベースルート）はNext側に既存テストが無かったため新規3ケースを追加した。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（12ファイル/84テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（456テスト green、無回帰）。手動smoke testはこのバッチから`curl`ではなく`safe-curl`（localhost向けの許可済みラッパー、ユーザー指摘により導入）を使用。
  - **残低リスク**: 23 − 6 = 17ルート。
- **2.5 バッチ5（完了・2026-09-19）**: 低リスク残17ルートから、`org-context-store`を共通の依存とするorg/objectivesクラスタ5ルート + org/strategy 1ルートを移植した: `org/objectives`（`GET`/`POST`）, `org/objectives/[id]`（`PATCH`/`DELETE`）, `org/objectives/[id]/key-results`（`POST`）, `org/objectives/[id]/key-results/[krId]`（`PATCH`/`DELETE`）, `org/objectives/import`（`POST`）, `org/strategy`（`GET`/`PATCH`）。実処理を `apps/server/src/routes/{org-objectives,org-strategy}.ts` に実装（objectives系は1リソース1ファイルにネストしたサブリソースをまとめ、teams・people同様のパターンを踏襲）。対応するNext側7ファイルは`proxyToHono`への委譲に置き換え、既存テスト6本はapps/server側へ移設。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（14ファイル/110テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（430テスト green、無回帰）。手動smoke testは`safe-curl`＋`EM_DATA_DIR`等の一時ディレクトリで実施。
  - **残低リスク**: 17 − 6 = 11ルート（実測しなおすと journal系6・settings/rules 1・themes系3 の計10ルート。1件は前バッチまでの計上ずれ。以降はファイル一覧の実測を都度基準にする）。
- **2.5 バッチ6（完了・2026-09-19）**: journalクラスタ6ルートを移植した: `journal`（`GET`/`POST`）, `journal/[id]`（`GET`/`PATCH`）, `journal/[id]/archive`（`POST`/`DELETE`）, `journal/[id]/no-action-needed`（`POST`/`DELETE`）, `journal/bulk`（`POST`）, `journal/search`（`GET`）。実処理を `apps/server/src/routes/journal.ts` に1ファイルへまとめて実装。
  - **付随リファクタ**: journalルートが依存する `web/src/app/api/name-candidate-response.ts`（フレームワーク非依存のMaskOptions組み立てロジック + Next専用のエラーレスポンス整形が混在）のうち、フレームワーク非依存部分（`parseAllowUnmaskedCandidates`/`parseRegisterNameCandidates`/`maskOptionsFromBody`/`maskOptionsFromBodyStrict`）を `packages/core/src/name-candidate-response.ts` へ抽出した。web側は re-export に変更（既存呼び出し元は無変更で動作）。apps/server側には同名のHono版 `apps/server/src/lib/name-candidate-response.ts`（`jsonFromUnknownError`をNextResponseではなく標準`Response.json`で実装、他は core から re-export）を新設。この分離パターンは、まだ移植していない `agents/**`・`issues/**`・`suggestions/**`・`journal/dumps/**`（高リスク）が同じヘルパーに依存しているため、それらのバッチでも再利用できる。
  - 対応するNext側6ファイルは`proxyToHono`への委譲に置き換え、既存テスト6本（計33ケース）はapps/server側へ移設。ただし移設時、`web/src/app/api/journal/route.test.ts`のみ元々`@core/name-candidate-detect`をモックしていなかった（実際の辞書・形態素解析に依存する「人名らしいが未登録の語句」テストがあるため）ことに気づかず、他5ファイルに合わせて全体を一括モックしてしまい1件失敗。原因判明後、モックを外して修正（実際の形態素解析が動く分テスト実行時間はやや伸びるが、全144件green）。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（15ファイル/143テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（397テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰。name-candidate-response.ts追加分は既存のname-candidate-confirmation経由の間接テストでカバーされ新規テストファイルは追加していない）。
  - **⚠️ 手動smoke testで見つかった問題（要フォローアップ）**: `POST /api/journal`をこの環境（ローカルMLモデル未ダウンロード）で`safe-curl`実行したところ、Node プロセスごとクラッシュした。自動テストはモックで無関係だが、「1リクエストの未処理例外がプロセス全体を落とす」点はフェーズ4（単一プロセス配信）に向けたリスクとしてリスクレジスタに追加した（下記参照）。
  - **残低リスク**: 10 − 6 = 4ルート（settings/rules 1・themes系3）。
- **2.5 バッチ7（完了・2026-09-19）**: 残っていた低リスク4ルートを移植し、低リスク41ルート全ての移植が完了した: `settings/rules`（`GET`/`PATCH`）, `themes`（`GET`/`POST`）, `themes/[id]`（`GET`/`PATCH`）, `themes/from-okr`（`POST`）。実処理を `apps/server/src/routes/{settings-rules,themes}.ts` に実装。対応するNext側4ファイルは`proxyToHono`への委譲に置き換え。`settings/rules`は既存テスト1本（26ケース）をapps/server側へ移設。`themes`系はNext側に専用テストが無かったため新規16ケースを追加。
  - **見つかった見落とし**: `web/src/app/api/hierarchy-flow.route.test.ts`（`themes/`ディレクトリの外にある、`themes/from-okr`を直接importするテストファイル）を初回のテスト移設対象の洗い出し（ディレクトリ単位のgrep）で見落としていた。移植後の`npm test -w web`で`ECONNREFUSED 127.0.0.1:8787`として発覚（プロキシがHonoサーバーへの実fetchを試みて失敗）。同等のシナリオは新設した`apps/server/src/routes/themes.test.ts`でカバー済みのため削除した。**教訓**: 移植対象ルートのテスト洗い出しは対象ディレクトリのgrepだけでなく、`grep -rl '@/app/api/<path>/route"' web/src`のようにリポジトリ全体を検索すること（`hierarchy-link-suggest.route.test.ts`のような統合テストが対象ディレクトリの外に置かれているケースがある）。次バッチ（高リスク側）でも同様の確認を行う。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（17ファイル/190テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（364テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。手動smoke testは`safe-curl`＋`EM_DATA_DIR`等の一時ディレクトリで実施（GETのみ。`settings/rules`はモデルダウンロードを`void`で発火するため、この環境ではPOSTを避けた）。
- **2.5 低リスク移植完了（2026-09-19）**: `web/src/app/api/**/route.ts`のうち低リスクに分類した41ルート全てが`proxyToHono`への委譲に置き換わったことを、`grep -L proxyToHono`で確認済み（残る"DIRECT"なルートは全て高リスク36ルートのみ）。次のバッチからは高リスク側（`agents/**`・`issues/**`・`journal/[id]/analyze`・`journal/batch`・`journal/dumps/**`・`journal/local-summarize`・`knowledge/interpretations`・`mask-check`・`models/status`・`org/objectives/parse`・`settings/data/**`・`suggestions/**`・`themes/distill`・`themes/link/suggest`・`issues/link/suggest`）に着手する。高リスク側は2.2で記載の通りagent-runtime起動（子プロセスspawn）を伴うものが多く、2プロセス構成での動作検証が追加で必要になる。
- **2.5 高リスク バッチ1（完了・2026-09-19）**: 高リスク36ルートのうち、最も単純な`agents`（`GET`/`POST`）, `agents/inbox`（`GET`）の2ルートを最初のバッチとして移植した。実処理を `apps/server/src/routes/agents.ts` に実装。
  - **重要な発見: agent-runtimeのwatchdog二重起動**: `packages/core/src/agent-runtime/scheduled-tasks.ts`は、importされた時点（モジュールロード時のトップレベル副作用）で`ensureWatchdogStarted()`を呼び、30秒間隔の`setInterval`（自動朝サマリー・週次蒸留・週次Grow・Journal集約バッチの自動チェック）を起動する。`agent-runtime/index`をimportするルート（今回の`agents`系を含め、高リスク36ルートの過半数）を`apps/server`側へ移植すると、Next側watchdogとHono側watchdogが**同時に2本**走ることになる。既存コードはこれを「next devのHMRによるモジュール再評価でwatchdogが増殖する」問題として認識済みで、3層の二重起動ガード（globalThisクレーム・ファイル永続化・DB上の当日run存在チェック）を備えている（`scheduled-tasks.ts`冒頭のコメント参照）。2プロセス化はこのガードが想定する「同一データを見る複数のwatchdogインスタンス」と構造的に同型のため、既存の設計がそのまま通用すると判断し、この前提で移植を進める。ただし**完全に無害とは言い切れない**（真の同時ヒット時のレースは3層目のDBチェックに依存する）ため、フェーズ2.7の完了基準確認時に実機（2プロセス起動した状態で自動バッチ時刻を跨ぐ）での再確認を追加項目とする。
  - 対応するNext側2ファイルは`proxyToHono`への委譲に置き換え、既存テスト2本（9ケース）はapps/server側へ移設。`POST /api/agents`のテストは`node:child_process`の`spawn`をモックする既存パターン（`FakeChildProcess`）をそのまま踏襲。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（18ファイル/199テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（355テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。手動smoke testはGETのみ（`POST /api/agents`は実エージェントCLIを起動しうるため、手動では叩かず自動テストのモックに委ねる方針。`journal`バッチの教訓を踏襲）。watchdog二重起動によるクラッシュ等の異常は起動確認の範囲では見られなかった。
  - **残高リスク**: 36 − 2 = 34ルート。
- **2.5 高リスク バッチ2（完了・2026-09-19）**: `agents/**`クラスタの残り9ルートを移植し、`agents/**`全11ルートの移植が完了した: `agents/[id]`（`GET`）, `agents/[id]/decide`（`POST`）, `agents/[id]/review`（`POST`）, `agents/[id]/themes`（`POST`/`DELETE`）, `agents/[id]/suggestion-updates`（`POST`/`DELETE`）, `agents/[id]/charter/dismiss`（`POST`）, `agents/[id]/sub-issues/dismiss`（`POST`）, `agents/[id]/issue-notes`（`POST`/`DELETE`）, `agents/pending-unmasked/[id]`（`POST`）。実処理を既存の `apps/server/src/routes/agents.ts` へ追記する形で実装（1リソース1ファイルの粒度を維持しつつ、`agents/pending-unmasked/:id`のみ別Honoインスタンス`agentsPendingUnmaskedRoute`としてエクスポートし、`/api/agents/pending-unmasked`という別パスにマウント）。
  - 対応するNext側9ファイルは`proxyToHono`への委譲に置き換え、既存テスト7本はapps/server側へ移設（既存の`insertRunRow`ヘルパーを`suggested_charter_json`/`suggested_themes_json`/`suggested_issue_notes_json`/`suggested_suggestion_updates_json`列も挿入できるよう拡張して一本化）。`agents/[id]/themes`と`agents/pending-unmasked/[id]`はNext側に専用テストが無かったため新規コースを追加した（`pending-unmasked`は`parkPendingUnmaskedSend`が`agent-runtime/index`からexportされておらず、テストからpending状態を直接作れないため、404系の最小限のカバレッジに留めた）。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（18ファイル/230テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（327テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。手動smoke testはGETのみ（`safe-curl`、`EM_DATA_DIR`等を一時ディレクトリへ向けて実施）。
  - **残高リスク**: 34 − 9 = 25ルート。`agents/**`は全11ルートの移植が完了。
- **2.5 高リスク バッチ3（完了・2026-09-19）**: `issues`（`GET`/`POST`）, `issues/[id]`（`GET`/`PATCH`）の2ルートを移植した。実処理を `apps/server/src/routes/issues.ts` に実装。`issues/link/suggest`（`link-suggest.ts`経由でcloud-chatを呼ぶため高リスク）は対象外で別バッチに残す。
  - 対応するNext側2ファイルは`proxyToHono`への委譲に置き換え、既存テスト2本（23ケース）はapps/server側へ移設。`POST /api/issues`は素のIssue作成のたびにLead Agentの分析Runを自動起動する（チーム先行並列で最大5run）ため、既存パターンと同じ`node:child_process`のspawnモック（エラー終了するフェイク子プロセス）を踏襲。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（19ファイル/253テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（304テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。手動smoke testはGETのみ。
  - **残高リスク**: 25 − 2 = 23ルート。
- **2.5 高リスク バッチ4（完了・2026-09-19）**: `suggestions`（`GET`/`POST`）, `suggestions/[id]`（`GET`/`PATCH`）, `suggestions/[id]/memo`（`POST`）の3ルートを移植した。実処理を `apps/server/src/routes/suggestions.ts` に実装（`issues.ts`と構造がほぼ並行——同じ`buildIssueDraftTask`/`parkPendingUnmaskedSend`パターンを共有）。
  - 対応するNext側3ファイルは`proxyToHono`への委譲に置き換え、既存テスト2本（16ケース）はapps/server側へ移設。`suggestions/[id]/memo`はNext側に専用テストが無かったため新規3ケースを追加（ポート中に`toSuggestionView`のログ相当フィールドが`log`ではなく`memos`であることに気づき、テストのフィールド名を修正）。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（20ファイル/272テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（290テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。手動smoke testはGETのみ。
  - **残高リスク**: 23 − 3 = 20ルート。
- **2.5 高リスク バッチ5（完了・2026-09-19）**: `themes/distill`（`POST`）, `growth/generate`（`POST`）の2ルートを移植した。両者とも`startDistillationAnalysis`/`startGrowAnalysis`（内部で`startRun`を呼ぶ、オンデマンド起動の同型エンドポイント）をそのまま呼ぶだけの薄いルートのため、`apps/server/src/routes/{themes-distill,growth-generate}.ts`として個別ファイルに実装（1ファイル1エンドポイントだが、既存の1ファイル1リソースの粒度から見ても妥当な最小単位）。
  - 対応するNext側2ファイルは`proxyToHono`への委譲に置き換え。Next側に専用テストが元々無かったため、`node:child_process`のspawnモックを使った新規テスト（起動確認・reviewed=trueの検証）をそれぞれ1件ずつ追加。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（22ファイル/274テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（290テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。両ルートともPOSTのみでagent起動を伴うため、手動smoke testはサーバー起動確認（`/api/health`）に留めた。
  - **残高リスク**: 20 − 2 = 18ルート。
- **2.5 高リスク バッチ6（完了・2026-09-19）**: `journal/[id]/analyze`（`POST`）, `journal/batch`（`POST`）の2ルートを移植した。どちらも`/api/journal`配下の既存パスのため、新規ファイルを作らず`apps/server/src/routes/journal.ts`へ追記する形で実装（`journal/batch`は`themes/distill`・`growth/generate`と同型のオンデマンド起動、`journal/[id]/analyze`は対象Journalの`confirmed`状態を検査してから`journal-analysis.ts`経由で起動する専用ロジック）。
  - 対応するNext側2ファイルは`proxyToHono`への委譲に置き換え。`journal/[id]/analyze`の既存テスト1本は`journal.test.ts`内の共有`agent-runtime/index`モックを拡張（`startJournalAnalysis`/`startJournalBatchAnalysis`/`toRunView`を追加）した上で移設。`journal/batch`はNext側に専用テストが無かったため新規2ケース（起動確認・pendingUnmasked時の202）を追加。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（22ファイル/279テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（287テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。両ルートともagent起動を伴うPOSTのみのため、手動smoke testはサーバー起動確認に留めた。
  - **手動smoke test用の一時ディレクトリ削除方法を修正**: `rm -rf`ではなく`rm-tmp <path>`（`/tmp`配下限定の削除ラッパー）を使うようユーザーから指摘。以降のバッチ・`dev-hybrid-rules.md`に反映。
  - **残高リスク**: 18 − 2 = 16ルート。
- **2.5 高リスク バッチ7（完了・2026-09-19）**: agent-runtime起動を伴わない「ローカルMLのみ」クラスタ4ルートを移植した: `models/status`（`GET`/`POST`）, `mask-check`（`POST`）, `journal/local-summarize`（`POST`）, `knowledge/interpretations`（`GET`/`POST`）。実処理を `apps/server/src/routes/{models-status,mask-check,journal-local-summarize,knowledge-interpretations}.ts` に実装（1ファイル1リソース）。
  - 対応するNext側4ファイルは`proxyToHono`への委譲に置き換え。既存テスト3本はapps/server側へ移設、`mask-check`はNext側に専用テストが無かったため新規5ケースを追加。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（26ファイル/293テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（278テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。`GET /api/models/status`は`ensureLocalModels()`をfire-and-forgetで発火する（journal POSTと同種のモデル未ダウンロード環境でのクラッシュリスク）ため手動smoke testの対象から外し、`knowledge/interpretations`のGETのみ`safe-curl`で確認した。
  - **残高リスク**: 16 − 4 = 12ルート。
- **2.5 高リスク バッチ8（完了・2026-09-19）**: `settings/data/backup`（`POST`）のみを移植した。実処理を `apps/server/src/routes/settings-data-backup.ts` に実装。
  - **重要な判断: `settings/data/reset`・`settings/data/restore`はあえて移植しない**。両ルートは`state-archive.ts`の`scheduleProcessExit()`（`setTimeout`後に`process.exit(0)`）を呼ぶ。これは「呼び出し元プロセス自身」を終了させる関数であり、Next↔Hono並走期間中にこの2ルートをHono側へ移すと、リセット／復元操作でHono（`apps/server`）プロセスだけが終了し、Next.js（ユーザーが実際にアクセスしているプロセス、`scripts/emther`が起動・監視する対象）は生きたまま「移植済みルートへのプロキシ先が死んでいる」壊れた状態になる。Docker（`restart: unless-stopped`）はコンテナ単位の再起動であり、コンテナ内の別プロセス（Hono）が落ちてもコンテナ自体もNextも再起動されない。したがってこの2ルートは、フェーズ4（単一プロセス配信への集約）まで意図的にNext側に残す。同様の「呼び出し元プロセスを終了させる」処理を持つ他のルートが今後見つかった場合も同じ基準で判断する。
  - 対応するNext側backupのみ`proxyToHono`への委譲に置き換え。共有テストファイル`web/src/app/api/settings/data/route.test.ts`からbackupのdescribeブロックを`apps/server/src/routes/settings-data-backup.test.ts`へ抽出・移設し、reset/restoreのdescribeブロックはNext側にそのまま残した（今後も実処理がNext側にあるため）。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（27ファイル/294テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（277テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。手動smoke testは`safe-curl -X POST`（`EM_DATA_DIR`等を一時ディレクトリへ向けた上で）でtar.gzが正しく返ることを確認（backupは読み取り専用でデータを変更しないため安全）。
  - **残高リスク**: 12 − 1 = 11ルート（`settings/data/reset`・`settings/data/restore`はフェーズ4まで意図的に未移植のまま残る。2.7完了基準の「実処理を持つroute.tsが残っていない」はこの2件を明示的な例外として扱う）。
- **2.5 高リスク バッチ9（完了・2026-09-19）**: `journal/dumps`クラスタ6ルートを移植した: `journal/dumps`（`GET`/`POST`）, `journal/dumps/[id]`（`GET`/`PATCH`）, `journal/dumps/[id]/parse`（`POST`）, `journal/dumps/[id]/accept`（`POST`）, `journal/dumps/preview`（`POST`）, `journal/dumps/profiles`（`GET`/`POST`/`DELETE`）。実処理を `apps/server/src/routes/journal-dumps.ts` に1ファイルへまとめて実装（`observation-dump-parse.ts`が`cloud-chat`経由でagent CLIを起動しうるため高リスク）。
  - **⚠️ 重要なバグを発見・修正: Honoの`app.route()`マウント順による静的パスの飲み込み**。`apps/server/src/app.ts`で `/api/journal`（`journalRoute`、`GET /:id`を持つ）を先にmountし、`/api/journal/dumps`（`journalDumpsRoute`、`GET /`を持つ）を後からmountしていたところ、実機で`GET /api/journal/dumps`を叩くと`{"error":"not found"}`（journalRouteの`GET /:id`が`id="dumps"`として飲み込んだ結果）が返ることが判明した。**単一のHonoインスタンス内（例: journalRoute自身の`/bulk`・`/search`と`/:id`の共存）ではstatic-vs-`:id`の優先順位が正しく効くが、`app.route()`で別々にmountした複数のサブアプリ間でprefixが重なる場合は、Honoは"先にmountされた方が勝つ"という異なる挙動になる**（登録順依存・specificity非依存）。同様の問題が`journal/local-summarize`（POST専用のため実害なし、GETのみ影響）・`themes/distill`（同様にPOST専用で実害なし）にも潜在していたため、この3件を親prefix（`journal`・`themes`）より前にmountする順序へ修正した。
  - **なぜユニットテストで気づけなかったか**: `apps/server/src/routes/*.test.ts`は各ファイルのHonoインスタンス（例: `journalDumpsRoute`）を直接`.request()`するパターンで書かれており、`apps/server/src/app.ts`が実際に合成する`app`インスタンスを経由しない。そのため3バッチ（バッチ7の`journal/local-summarize`・バッチ5の`themes/distill`・本バッチの`journal/dumps`）に渡ってこの不具合が自動テストをすり抜けていた。手動`safe-curl`によるsmoke testで初めて発覚した。
  - **恒久対策**: `apps/server/src/app.test.ts`を新設し、合成済みの`app`（`createApp()`の実際の出力）に対して直接リクエストする回帰テストを追加した（`GET /api/journal/dumps`・`GET /api/journal/dumps/profiles`・`GET /api/journal/:id`（実在しないID）・`GET /api/agents/inbox`・`GET /api/journal`を検証）。**今後、あるprefix配下のサブパスを別ファイルへ切り出す（例: `/api/foo/bar`を`/api/foo`とは別ファイルにする）ときは、(1) 親（`:id`ワイルドカードを持つ）より必ず先にmountする、(2) `app.test.ts`に確認項目を追記する、の2点を徹底する**（`app.ts`冒頭のコメントにも同内容を明記済み）。
  - 対応するNext側6ファイルは`proxyToHono`への委譲に置き換え。既存テスト1本（5ケース）はapps/server側へ移設し、`[id]`・`[id]/parse`・`preview`・`profiles`はNext側に専用テストが無かったため新規14ケースを追加。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（29ファイル/318テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（271テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。手動smoke testは`safe-curl`のGETで`/api/journal/dumps`系の疎通・マウント順修正の効果を確認（POST/PATCH等の変更系はcloud-chat呼び出しリスクがあるため自動テストのモックに委ねた）。
  - **残高リスク**: 11 − 6 = 5ルート（うち2ルートは意図的に未移植のため、実質移植対象は3ルート: `org/objectives/parse`・`issues/link/suggest`・`themes/link/suggest`、いずれもcloud-chat経由でagent CLIを起動する同系統のルート）。
- **2.5 高リスク バッチ10（完了・2026-09-19）**: 残っていた高リスク3ルート（`org/objectives/parse`, `issues/link/suggest`, `themes/link/suggest`）を移植し、**フェーズ2.5（低リスク41 + 高リスク34、`settings/data/reset`・`restore`を除く）の全移植が完了した**。実処理を `apps/server/src/routes/{org-objectives-parse,issues-link-suggest,themes-link-suggest}.ts` に1ファイル1エンドポイントで実装。3ルートとも、対応する親prefix（`org/objectives`・`issues`・`themes`。いずれも`:id`ワイルドカードを持つ）より**先に**mountした（バッチ9で見つけたHonoのマウント順バグの教訓を踏襲）。
  - `apps/server/src/app.test.ts`に3ルート分の回帰チェック（合成済み`app`への直接リクエストで、親prefixの`:id`/`PATCH`ハンドラに飲まれず正しいルートへ届くことを確認）を追加。
  - 対応するNext側3ファイルは`proxyToHono`への委譲に置き換え。既存テスト2本（`org/objectives/parse/route.test.ts`全体・`hierarchy-link-suggest.route.test.ts`のうちroute層の2 describeブロック）をapps/server側へ移設。`hierarchy-link-suggest.route.test.ts`には`@core/link-suggest`をルート層を介さず直接呼ぶユニットテスト（「link-suggest unit」describe）が残っており、これはルート移植と無関係のため引き続きweb側に残置した。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（32ファイル/328テスト green）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（265テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。手動smoke testは`safe-curl`で`issues/link/suggest`・`themes/link/suggest`のPOST（ヒューリスティックfallback、空ストアなのでcloud-chatを実際には呼ばない）と、`org/objectives/parse`はtext必須の400ケースのみ確認（200ケースは実際にcloud-chatを呼びうるため自動テストのモックに委ねた）。親ルート（`org/objectives`・`issues`・`themes`）のGETが引き続き正常に動くことも確認。
  - **残高リスク**: 5 − 3 = 2ルート。この2ルート（`settings/data/reset`・`settings/data/restore`）は前述のとおりフェーズ4まで意図的に未移植のまま残す。**フェーズ2.5は実質的に完了**。
- **2.6 Zod 導入（完了・2026-09-19）**: 2nd_architecture.md 3.4節の方針どおり、全77ルート一律ではなく `journal`（POST `/`・PATCH `/:id`・POST `/bulk`）と `settings/rules`（PATCH `/`）の2ルートに絞って導入した。
  - **着手前の判断**: 実装を読んだところ、これら2ファイルの入力検証は「不正な型の値は黙ってundefined扱いにする（＝変更しない）」という寛容な設計と、多数のユーザーフィードバックに基づく個別のビジネスロジック（PERSON_n照合、Cursor CLIの既知バグ回避のための専用エラーメッセージ、CLI名一覧との照合等）が密結合しており、全面的なZodスキーマ置き換えは恩恵に対してリライトのリスクが高いと判断した。ユーザーに方針を確認し、「既存の挙動（エラー文言・寛容さ）を完全に維持したまま、型ガードのボイラープレート部分だけをZodスキーマに置き換える」軽量導入で合意した。
  - **実装方針**: 各フィールドに `.optional().catch(undefined)` を付け、パース失敗（型不一致）時は例外を投げず既存同様に「未指定」扱いへフォールバックさせる。オブジェクト全体にも `.catch({})` を被せ、`body` がnull・非オブジェクトでも例外を投げない（`journal.ts`・`settings-rules.ts`とも同じパターン）。DB参照・個別エラーメッセージを伴う関数（`parseSelfPersonId`, `parseReferenceLookupCursorModel`, `agentModelTiers`, `agentCliModels`, `cliOrder`, `localChatModelPreset`, `referenceLookupClaudeModel`, `positiveInt`, `positiveUsd`, `hourList`, `weekdayList`）はスコープ外とし、従来どおり専用関数のまま残した。
    - `journal.ts`: POST `/`（`text`/`occurredAtDate`/`people`/`teams`/`teamIds`）・PATCH `/:id`（上記に加え`rawText`/`tags`/`urgency`/`sentiment`/`resolvedIssueId`/`resolutionNote`。`urgency`/`sentiment`は`z.enum`、`resolvedIssueId`/`resolutionNote`は「未指定=変更しない／null=解除／文字列=設定」の3値を`z.string().nullable().optional().catch(undefined)`で表現）・POST `/bulk`（`text`のみ、`.pick()`で派生）。
    - `settings-rules.ts`: 個別のビジネスロジックを伴わない単純な数値・真偽値フィールド（`teamWindowDays`等10個の数値系、`autoIssueUpdateAnalysisEnabled`等6個の真偽値系、旧キー互換の`autoJournalBatchHour`/`autoDistillationWeekday`、クランプ前の`autoDistillationHour`/`autoGrowWeekday`/`autoGrowHour`）のみをZod化。従来の`bool()`ヘルパーは全呼び出し箇所が置き換わったため削除。`num()`は`positiveInt`/`positiveUsd`が内部で使い続けるため残置。
  - **既知の軽微な挙動差（テスト未カバー・意図的に許容）**: 配列フィールド（`people`/`teams`/`teamIds`/`tags`）は、従来は要素単位で`typeof p === "string"`をフィルタし文字列要素だけを残していたが、Zod化後は`z.array(z.string())`が要素の型不一致を検知すると配列全体を`.catch(undefined)`で「未指定」に落とす（部分的なフィルタではなく全体のフォールバック）。文字列以外の要素が混在した配列を送るクライアントは実質存在せず、テストにも該当ケースが無いため許容した。
  - **検証済み**: `npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/server`（32ファイル/328テスト green、無回帰）、`npm run typecheck -w web`（既存の無関係な5件のみ）、`npm test -w web`（265テスト green、無回帰）、`npm test -w @emther/core`（728テスト green、無回帰）。`journal`/`settings-rules`個別のテストファイルも全項目green（38・32テスト）で、エラー文言・ステータスコード・寛容さが1:1で保たれていることを確認。
  - **依存追加時の注意**: `apps/server`に`zod`を追加。`.npmrc`の`min-release-age=7`制約（2.1節既知の注意点）により、着手日（2026-09-19）時点の直近7日以内の`4.6.3`（2026-09-12公開）は対象外とし、`4.6.2`（2026-09-10公開）に固定した。
- **2.7 完了基準（達成・2026-09-19）**: `src/app/api/**` に実処理を持つ `route.ts` が残っていない（全て Hono 側の呼び出しに委譲、または削除済み）ことを `grep -L proxyToHono web/src/app/api --include="route.ts"` で確認済み（結果は`settings/data/reset`・`restore`の2件のみ、意図的な例外）。既存のAPI契約（レスポンス形状）はルート移植の各バッチで個別テストにより維持を確認済み。加えて、リスクレジスタに残っていた2項目を実機検証し、両方とも実際に問題を再現したうえで修正した。
  - **① `app.onError`/`process.on("unhandledRejection")`の要否（検証・対応済み）**: `EM_DATA_DIR`等を一時ディレクトリに向けた隔離環境で`POST /api/journal`を実行し、フェーズ2.5バッチ6で推測されていたクラッシュを実際に再現した。原因は`@huggingface/transformers`の`loadResourceFile`（モデル未ダウンロード時）が投げる例外で、リクエストのawaitチェーンの外（ライブラリ内部の非同期処理）で発生するため、ルート側の`try/catch`はおろか`app.onError`（Honoのリクエスト処理チェーン内のエラーハンドラ）でも捕捉できず、デフォルトのNode挙動でプロセスごと即座にクラッシュすることを確認した。
    - 対応: `apps/server/src/index.ts`に`process.on("uncaughtException", ...)`・`process.on("unhandledRejection", ...)`を追加し、ログを残してプロセスを継続させる（当該リクエストのクライアントは応答なしでタイムアウトするのみに留まる。デフォルトの即クラッシュより可用性が高い）。同じ隔離環境で同じ手順を再実行し、同じ例外が2回ログに記録されつつプロセスが生存し続け、`GET /api/health`が引き続き200を返すことを確認した。
    - 加えて`app.onError`（`apps/server/src/lib/error-handling.ts`の`honoErrorHandler`）も`createApp()`に配線した。こちらは各ルートの`try/catch`から漏れた同期スロー・async関数内の素朴なthrowを拾って500 JSONへ変換する防御的な追加（今回再現したクラッシュそのものの直接の対策ではないが、隣接するギャップを併せて塞いだ）。ユニットテスト（`apps/server/src/lib/error-handling.test.ts`）で動作確認済み。
  - **② agent-runtime watchdogの2プロセス二重起動（検証・対応済み）**: `packages/core/src/agent-runtime/index`をimportするだけで動く同一のwatchdogモジュールを、同じ`EM_DATA_DIR`を指す2つの独立したNodeプロセス（tsxスクリプト）としてほぼ同時に起動し、`autoMorningSummaryEnabled: true`・`autoMorningSummaryHour: 0`（常に「時刻到達済み」）を事前に設定したうえで、双方のwatchdog（30秒間隔）の初回tickを待った。
    - **結果（修正前）**: 想定されていた「完全に無害とは言い切れない」という評価どおり、実際に**2件の重複した`origin=auto-summary`のLead Agent runがDBに作成された**（`created_at`の差はわずか1ミリ秒）。既存の3層ガード（globalThisクレーム・JSON永続化・DB run確認）はいずれも「読み取り→書き込み」という同一プロセス内の同期実行を前提にしており、別プロセスの書き込みタイミングとは無関係にTOCTOU（読み取り後・書き込み前に他プロセスが割り込む）が発生しうることが実証された。この二重起動は`startRun`が実際にAgent CLIを起動する処理を含むため、**日次の自動バッチのたびに課金対象のCLI呼び出しが二重に発生しうる**、実害のある不具合と判断した。
    - **修正**: `packages/core/src/db.ts`に`auto_batch_claims`テーブル（`claim_key TEXT PRIMARY KEY`）を追加し、`scheduled-tasks.ts`に`tryClaimAutoBatchSlot(claimKey)`（`INSERT`が例外なく成功すれば`true`、UNIQUE制約違反なら`false`）を実装。SQLiteへのINSERTはOSのファイルロックでプロセスをまたいで直列化されるため、既存の3層ガードでは防げなかったTOCTOUをここでは原子的に防げる。4つの自動バッチ関数（`checkMorningSummary`/`checkJournalBatchReview`/`checkWeeklyDistillation`/`checkWeeklyGrow`）全てに、`start*()`を呼ぶ直前の最終ゲートとしてこのクレームを追加した（キーは各関数の既存の粒度に合わせる: `auto-summary:${today}` / `auto-journal-batch:${today}:${unclaimedDue}` / `auto-distill:${week}:${weekday}` / `auto-grow:${week}`）。既存の3層ガード自体は単一プロセス内のHMR対策として引き続き有効なため削除していない（純粋な追加）。
    - **再検証**: 同じ2プロセス実機テストを修正後のコードで再実行し、**重複なく1件だけ**`auto-summary` runが作成され、`auto_batch_claims`にも1件だけクレームが記録されることを確認した。
    - **回帰テスト**: `packages/core/src/agent-runtime.test.ts`に、他の3層ガードを素通りする状況（`auto_batch_claims`だけ他プロセスが先取り済み）を直接作ってstartRunが呼ばれないことを確認するテストを追加（`checkMorningSummary`経由。他3関数は同型の実装のため個別のユニットテストは追加していない）。
  - **検証済み**: `npm run typecheck -w @emther/core`・`npm run typecheck -w @emther/server`（エラー0）、`npm test -w @emther/core`（729テスト green、+1は今回の回帰テスト）、`npm test -w @emther/server`（330テスト green、+2は`error-handling.test.ts`）、`npm test -w web`（265テスト green、無回帰）。手動smoke testは全て`EM_DATA_DIR`等を隔離した使い捨てディレクトリで実施し、実データへの影響なし。
  - **例外**: `settings/data/reset`・`settings/data/restore`は`scheduleProcessExit()`（呼び出し元プロセスの`process.exit`）を呼ぶため、フェーズ4（単一プロセス配信）までNext側に実処理を残す意図的な例外のまま（高リスク バッチ8参照）。

---

## フェーズ3: Vite SPA 立ち上げ・画面移植

対象: 現行 `src/app/**/page.tsx`（21画面）+ `src/components`（123ファイル）。

- **3.1 `apps/web`（新）骨組み（完了・2026-09-19）**: Vite + React 19 + React Router（ライブラリモード、`createBrowserRouter`/`RouterProvider`）で新規 SPA を `apps/web`（`@emther/web`）に用意した。既存の旧 Next.js 実装は `web/`（物理リネームしない方針、1.1参照）のまま残るため、両者はディレクトリとして自然に並存する（当初案の「既存apps/web（旧Next.js）」という記述は1.1の判断変更前の想定で、実際には旧実装は`web/`にある）。
  - **実施内容**: `package.json`（`dev`=`vite`、`build`=`tsc --noEmit && vite build`、`typecheck`/`test`/`test:watch`）、`vite.config.ts`（`@vitejs/plugin-react`。dev時は`/api`を`HONO_SERVER_URL`/`HONO_PORT`環境変数で指す`apps/server`へプロキシ。`dev-hybrid-rules.md`の環境変数命名と統一）、`tsconfig.json`（`apps/server`と同系統の設定。`moduleResolution: bundler`）、`index.html`、`src/main.tsx`（`createBrowserRouter`с`/`一本のプレースホルダールートのみ。画面追加は3.4/3.5）、`src/App.tsx`（骨組み確認用の最小コンポーネント）、`vitest.config.mts`/`vitest.setup.ts`（`web/`と同じjest-dom + Testing Libraryパターン、`environment: "jsdom"`固定）、`src/App.test.tsx`（スモークテスト1件）を新設。ルート`package.json`の`workspaces`には元々`apps/*`が含まれていたため追記不要。
  - **依存関係**: `.npmrc`の`min-release-age=7`制約（2.1節の既知の注意点）により、着手日（2026-09-19）時点で7日未満だった`vite@8.3.1`ではなく`vite@8.3.0`、`react-router@8.4.0`ではなく`react-router@8.3.1`（8.4.0は4日前公開で対象外）を採用。`@vitejs/plugin-react@6.1.1`・`jsdom@30`等は`web/`側と揃えた。
  - **付随した落とし穴**: `apps/web`追加で新しい`esbuild@0.28.2`（vite/tsxの依存）が`allowScripts`未許可としてブロックされた（`npm warn install-scripts`）。ネイティブバイナリ取得のための正当なpostinstallと判断し、`npm install-scripts approve esbuild@0.28.2`でルート`package.json`の`allowScripts`に追加した。また、`tsconfig.json`の`include`に`vitest.setup.ts`を含め忘れると、`@testing-library/jest-dom/vitest`のアンビエント型拡張（`toBeInTheDocument`等）が`tsc --noEmit`から見えず型エラーになることが判明し、`include`に追加して解消した。
  - **検証済み**: `npm run typecheck -w @emther/web`（エラー0）、`npm test -w @emther/web`（1ファイル/1テスト green）、`npm run build -w @emther/web`（`vite build`成功、`dist/`に出力。出力先を`dist/client`に揃えるのはフェーズ4.2で行う）、`npm run dev -w @emther/server` + `npm run dev -w @emther/web`を同時起動し、`safe-curl`で`http://127.0.0.1:5273/`（Viteが返すHTML）と`http://127.0.0.1:5273/api/health`（Honoへのプロキシ経由で`{"ok":true}`）の両方を確認。既存3ワークスペース（`web`/`@emther/core`/`@emther/server`）の`typecheck`・`test`は無回帰（web側の既存5件のみ、core 729・server 330は変更前と同数）。
  - **CI追随**: `.github/workflows/ci.yml`の`typecheck`/`test`ジョブに`-w @emther/web`を追加、`build`ジョブに`npm run build -w @emther/web`を追加。`lint`ジョブへの追加は見送り（`apps/server`同様、ESLint設定は未整備。6.1節の「最終形」で flat config を入れる際にまとめて対応）。
- **3.2 サーバー状態層（完了・2026-09-19）**: `@emther/web`に`@tanstack/react-query`（`.npmrc`のmin-release-age制約により`5.103.1`ではなく`5.102.8`を採用）を導入し、`apps/web/src/main.tsx`に`QueryClientProvider`（プロセス内シングルトンの`queryClient`）を配線した。
  - **方針決定（1:1移植 + invalidate/setQueryDataは呼び出し側判断）**: `web/src/lib/hooks.ts`の`usePolling`群（25フック）は全て同じ形（fallback付きGET・`intervalMs`ポーリング・`enabled`フラグ・ミューテーション後にローカルstateへ即時反映する`setXxx`）のため、全面的な設計見直しは行わず**ポーリング自体は1:1**（`usePolling`の`intervalMs`/`enabled`は`useQuery`の`refetchInterval`/`enabled`にそのまま対応）で移植する。一方、旧`usePolling`が個別に持っていた`setXxx`（楽観的ローカル更新）は、TanStack Queryの標準機構である`queryClient.setQueryData(queryKey, ...)`を呼び出し側が直接使う形に置き換え、フック側に個別setterを用意しない（キャッシュ更新はTanStack Query自身の責務に一本化するのが素直なため、旧実装の「フックごとに車輪を再発明したsetter」を残す理由がない）。
  - **エラー処理の意図的な差分**: 旧`usePolling`は「fetch失敗時は静かに無視し次回ポーリングに任せる」設計だったが、TanStack Queryでは`fetchJson`（`apps/web/src/lib/api.ts`、`res.ok`でなければthrow）がエラーをそのままthrowし、`useQuery`の標準的なerror状態（既定で自動リトライ）に委ねる方針にした。明示的なエラーUIが必要な画面は個別に`query.isError`を見る（3.5で画面ごとに判断）。
  - **queryKey命名規約**: `["api", ...URLのpathセグメント, ...パラメータ]`に統一し、ミューテーション成功後の`invalidateQueries`がURL単位で機械的に書けるようにする（`useTimeline`の例: `["api", "timeline"]`）。
  - **実装**: `apps/web/src/lib/api.ts`（`fetchJson<T>`共通フェッチヘルパー）、`apps/web/src/lib/queries.ts`（`usePolledQuery`汎用ラッパー + 代表例として`useTimeline`のみを移植。型は`@emther/core/types`から`import type`で直接参照）。残り24フックの移植は本節では行わず、3.5（画面単位移植）でその画面を移すタイミングに合わせて行う方針とした（1画面分の移植作業とデータ層の移植を分離しない）。
  - **見つかった落とし穴**: `renderHook`のテストで、`queryClient.refetch()`をawaitした直後（`act`の中）に`result.current`を同期的に読むと、更新前の値が返ることがある（TanStack Queryの通知がReactの`act`フラッシュと必ずしも同期しないため）。Reactの状態更新関数を直接呼ぶ`usePolling`時代の書き方をそのまま踏襲すると失敗するテストになる。`waitFor`で結果を待つ形に修正して解消した（`apps/web/src/lib/queries.test.tsx`参照。画面移植時のテスト作成でも同じ注意が必要）。
  - **検証済み**: `npm run typecheck -w @emther/web`（エラー0）、`npm test -w @emther/web`（2ファイル/5テスト green）、`npm run build -w @emther/web`（成功）。
- **3.3 型安全クエリパラメータ（完了・2026-09-19）**: `apps/web/src/lib/useTypedSearchParams.ts`を実装した。`web/src/app/**`・`hooks.ts`（`usePeekParam`）を`grep`で棚卸しし、全箇所が`searchParams.get(key)`（単純な文字列・無ければnull）という同型パターンであることを確認した上で、React Routerの`useSearchParams` + Zodスキーマの薄いラッパーとして設計した。
  - **API**: `useTypedSearchParams(schema: z.ZodObject<Shape>) => [values, setParams]`。`values`は`schema.parse(Object.fromEntries(searchParams))`（URLSearchParams由来の値は常に文字列のため型不一致は起きない。フィールドを`z.string().optional()`にすれば「無ければundefined」がNext側`.get()`のnull相当になる。enum等より厳密な検証をしたい場合はフェーズ2.6で確立した`.optional().catch(undefined)`の寛容さの規約を踏襲する）。`setParams(updates, {replace})`は指定キーを更新し、値が`undefined`のキーは削除する（旧`usePeekParam`の`open()`/`close()`に相当）。既定で`replace: true`（旧`router.push(..., {scroll: false})`が履歴を積み増す意図ではなかったことに合わせる）。
  - **実装は行うが呼び出し側の移植は3.5へ**: `web/src/app/chat`（`runId`/`journalId`/`prefill`）、`journal`（`focus`/`dump`/`prefill`）、`org`（`objective`）、`org/thread`（`objective`）、`teams`（`focus`）、`ThemesPanel`（`theme`）、`hooks.ts`の`usePeekParam`（issues/suggestions/people等の汎用peekパターン）が呼び出し候補。3.2のuseTimelineと同じ判断で、実際の置き換えは該当画面を移植するタイミング（3.5）にまとめて行う（フックの移植と画面の移植を分離しない）。
  - **検証済み**: `npm run typecheck -w @emther/web`（エラー0）、`npm test -w @emther/web`（3ファイル/11テスト green。パース・enum不一致時の`.catch`・`setParams`での追加/削除・既存クエリの保持を検証）、`npm run build -w @emther/web`（成功）。
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
| ~~Hono単体では1リクエストの未処理例外（try/catch外の非同期処理・fire-and-forget）がNodeプロセス全体をクラッシュさせうる（Next.jsのリクエスト単位エラー境界が無い）~~ **解決済み（2026-09-19、フェーズ2.7）** | 2, 4 | フェーズ2.5 バッチ6（journal移植）の手動smoke testで推測された事象を、フェーズ2.7で隔離環境の実機再現により確定（`@huggingface/transformers`のモデル未ダウンロード時の例外がawaitチェーン外で発生）。`apps/server/src/index.ts`に`process.on("uncaughtException"/"unhandledRejection")`を追加してプロセス継続を確認、`app.onError`（`apps/server/src/lib/error-handling.ts`）も併せて配線した。詳細はフェーズ2.7参照 |
| ~~`agent-runtime`（`scheduled-tasks.ts`）をimportするルートをHono側へ移植すると、Next側と合わせてwatchdog（30秒間隔の自動バッチチェック）が2プロセスで同時に走る~~ **解決済み（2026-09-19、フェーズ2.7）** | 2 | フェーズ2.5 高リスク バッチ1（`agents`移植）で発見。フェーズ2.7で2プロセスを実機起動し**実際に重複起動（1ミリ秒差で2件のauto-summary run）を再現・確認**。`packages/core/src/db.ts`に`auto_batch_claims`テーブル（SQLite UNIQUE制約による原子的クレーム）を追加し、4つの自動バッチ関数全てに起動直前の最終ゲートとして組み込み、同じ実機テストで重複が解消することを確認した。詳細はフェーズ2.7参照 |
| `settings/data/reset`・`settings/data/restore`は`scheduleProcessExit()`（呼び出し元プロセスの`process.exit`）を呼ぶため、Next↔Hono並走期間中にHono側へ移植するとリセット／復元のたびにHonoプロセスだけが落ち、Next.js側はプロキシ先が死んだ壊れた状態になる | 2 | フェーズ2.5 高リスク バッチ8で発見。この2ルートはフェーズ4（単一プロセス配信）まで意図的にNext側に残す（本ファイル該当箇所参照）。フェーズ4の`emther start/restart`実機確認と合わせて最終的に移植する |
| `apps/server/src/app.ts`で別々の`app.route()`マウント間にprefixの重なりがあると、Honoは静的パスを優先せず「先にmountされた方」が勝つ（単一Honoインスタンス内でのstatic-vs-`:id`優先とは異なる挙動）。ユニットテストが各ルートファイルのHonoインスタンスを直接requestする形式のため、この種のマウント順バグを検出できない | 2 | フェーズ2.5 高リスク バッチ9で`GET /api/journal/dumps`が`journalRoute`の`GET /:id`に飲まれる不具合として発見・修正。`apps/server/src/app.test.ts`（合成済み`app`への直接リクエスト）を新設し恒久的な回帰ガードとした。新しいサブパス切り出し時は親より先にmountすることを`app.ts`冒頭にコメントで明記 |

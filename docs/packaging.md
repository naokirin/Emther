# 配布・パッケージ化方針

個人の EM サポートツール **Emther（EM Support System）** として、**GitHub 公開リポジトリから入手でき、利用者のマシン上にだけ機微データが残る**ことを目標にする。npm レジストリへの公開はしない。

関連実装: `packages/core/src/persistence.ts`（データパス）、`scripts/emther`（ランチャー）、`scripts/package-standalone.sh` / `scripts/trace-server-deps.mjs` / `scripts/install-release.sh`（Release 成果物）、ルート `README.md`（配布手順）、`docs/docker.md`（隔離プロファイル）、`.github/workflows/release.yml`。第2世代アーキテクチャ（Vite + Hono）への移行の経緯・詳細は `docs/2nd_architecture.md` / `docs/2nd_architecture/plan.md` を参照。

## 製品像

| レイヤ | 置き場所 | 備考 |
| --- | --- | --- |
| ソース | GitHub（公開） | clone して `./scripts/emther install` |
| アプリ本体 | `~/.local/share/emther/app` | `apps/server`（Hono、esbuildで単一ファイルへバンドル）+ `apps/web`（Vite ビルドの静的ファイル） |
| 起動コマンド | `~/.local/bin/emther` | install / install-release / build / start / stop / restart / status / doctor / backup / restore |
| 業務データ | `~/.local/state/emther/data` | SQLite・JSON。リポジトリ外必須 |
| 実名対応表 | `~/.local/state/emther/secure` | 0700 / 0600。data と兄弟だが権限分離 |
| バックアップ | `~/.local/state/emther/backups` | `emther backup` が作成 |
| モデルキャッシュ | `~/.cache/huggingface` 等（将来は `~/.cache/emther` も検討） | アプリ本体に同梱しない |
| Agent CLI | 利用者ホスト（必須: `claude`） | `agy` / `cursor-agent` は任意 |
| 隔離実行 | Docker Compose（任意） | 認証・依存ごとコンテナに閉じたい人向け |

**同梱しないもの:** API キー、people-directory、モデル重み。認証と初回ダウンロードは利用者各自。ホストには引き続き **Node 24+** が必要（Release tarball も同様）。

## ホストインストール（現行）

前提: Node 24+、（Agent Run を使うなら）ホストに `claude` CLI。手順の正本はリポジトリ直下の `README.md`。

```bash
# ソースから
git clone https://github.com/naokirin/Emther.git
cd Emther
./scripts/emther install

# または GitHub Release の tarball から
tar -xzf emther-vX.Y.Z-linux-x64.tar.gz
./emther/install.sh

emther start
emther restart                 # stop → start
emther start --port 3001       # または EM_PORT=3001 emther start
emther doctor
emther backup
```

端末移行のバックアップ／復元／全データ削除は、CLI に加えて UI の **設定 → データ** からも実行できます（アーカイブ形式は `emther backup` と同じ。復元・リセット後はプロセスが停止するため再起動が必要です）。CLI を正本とし、UI は同操作の補助経路です。

- 既定で **127.0.0.1:3000** のみにバインドする（LAN 公開しない）。`--host` / `--port`（または `EM_HOST` / `EM_PORT`）で変更可能。優先順位は CLI フラグ > 環境変数 > デフォルト。
- ビルドは `scripts/package-standalone.sh` が担う: `apps/server` を esbuild で `dist/server.js`（単一ファイル）へバンドルし、`apps/web` を `vite build` で `dist/client`（静的ファイル）へビルドする。`@huggingface/transformers` / `onnxruntime-node` / `kuromoji` はネイティブ依存のためバンドルせず `external` 指定し、`scripts/trace-server-deps.mjs`（`@vercel/nft` による依存関係トレース）で実行時に必要な `node_modules` だけをステージング先へ個別配置する（`kuromoji` は動的 require + 辞書データを含むためディレクトリごとコピー）。単一 Node プロセスが `dist/client` の静的配信と `/api/*` を同一ポートで兼ねる（詳細は `docs/2nd_architecture/plan.md` フェーズ4）。
- UI フォントは `@fontsource/*` を npm 同梱し、ビルド時に Google Fonts へネットワークしない。
- Docker 用のビルドも同じ `apps/server` + `apps/web` 構成を使う。詳細は `docs/docker.md`。

## 入手チャネル

1. **主経路:** 公開リポジトリを clone → `./scripts/emther install`（`README.md`）
2. **GitHub Releases:** タグ `v*` push で CI（`.github/workflows/release.yml`）が `linux-x64` / `darwin-arm64` の tarball + SHA256 を添付
3. **npm 公開:** しない（`npx` も主経路にしない）
4. **Docker:** セカンドクラス。手順は `docs/docker.md`

### Release の切り方

```bash
git tag v0.1.0
git push origin v0.1.0
```

成果物名の例: `emther-v0.1.0-linux-x64.tar.gz`（中身は `app/` + `bin/emther` + `install.sh`）。  
onnxruntime 等は OS/CPU 固有のため、必ず自分の platform 用を選ぶ。

## データパス規約（Phase 0）

デフォルト（環境変数未設定時）:

```text
~/.local/state/emther/data/     # EM_DATA_DIR で上書き可
~/.local/state/emther/secure/   # EM_SECURE_DATA_DIR で上書き可
```

- 開発・テスト・Docker は従来どおり環境変数で差し替える。
- リポジトリ配下の `./.data`（`persistence.ts`が旧配置移行チェックで参照するcwd基準パス）には**新規書き込みしない**（公開 clone 作業ツリーと機微データの混在を防ぐ）。
- 旧配置からの一度きりの移行（存在する場合のみ、宛先が未作成のとき）:
  - `~/.local/state/em-ai-team/{data,secure}` → `.../emther/{data,secure}`
  - `./.data`（起動時 cwd 基準の旧デフォルト）→ `.../emther/data`
  - `~/.local/state/em-ai-team-secure` → `.../emther/secure`

## ロードマップ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 0 | デフォルトデータパスの XDG 化＋旧配置からの移行 | 実装済み |
| 1 | Next.js `output: "standalone"` ＋ `emther` ランチャー | 実装済み（2026-09、`apps/server`（esbuild）+ `apps/web`（Vite）構成へ移行。`docs/2nd_architecture/`参照） |
| 2 | `doctor` / `backup`（`restore`）／ルート配布 README | 実装済み |
| 3 | CI から GitHub Release 成果物を作成 | 実装済み |

## 明示的にやらないこと

- npm 公開・単一バイナリ化・Electron/Tauri（必要性が出てから再検討）
- ホスト配布での Agent CLI 完全同梱の必須化（認証が個人単位のため。同梱は Docker 側の強み）

## セキュリティ上の注意（公開リポジトリ）

- `.env`・認証ディレクトリ・state 配下はコミットしない（既存の ignore を維持）。
- バックアップ対象は主に `data` + `secure`（`emther backup` および Settings → データ）。アーカイブは個人情報を含むため取り扱いに注意。
- 本番インターネット公開は想定しない（認証なしの単一ユーザー向け）。ランチャー既定も localhost のみ。

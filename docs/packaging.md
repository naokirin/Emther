# 配布・パッケージ化方針

個人の EM サポートツール **Emther（EM Support System）** として、**GitHub 公開リポジトリから入手でき、利用者のマシン上にだけ機微データが残る**ことを目標にする。npm レジストリへの公開はしない。

関連実装: `web/src/lib/persistence.ts`（データパス）、`scripts/emther`（ランチャー）、`scripts/package-standalone.sh` / `scripts/install-release.sh`（Release 成果物）、ルート `README.md`（配布手順）、`docs/docker.md`（隔離プロファイル）、`.github/workflows/release.yml`。

## 製品像

| レイヤ | 置き場所 | 備考 |
| --- | --- | --- |
| ソース | GitHub（公開） | clone して `./scripts/emther install` |
| アプリ本体 | `~/.local/share/emther/app` | Next.js standalone（webpack ビルド） |
| 起動コマンド | `~/.local/bin/emther` | install / install-release / build / start / stop / status / doctor / backup / restore |
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
emther doctor
emther backup
```

- 既定で **127.0.0.1** のみにバインドする（LAN 公開しない）。
- standalone ビルドは `npm run build:standalone`（`next build --webpack`）。Turbopack 既定ビルドだと `serverExternalPackages`（transformers / onnx）が欠ける既知問題があるため。
- UI フォントは `@fontsource/*` を npm 同梱し、ビルド時に Google Fonts へネットワークしない。
- Docker 用の `npm run build` はそのまま（フル `node_modules` + `next start`）。standalone 成果物は使わない。

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
- リポジトリ配下の `web/.data` には**新規書き込みしない**（公開 clone 作業ツリーと機微データの混在を防ぐ）。
- 旧配置からの一度きりの移行（存在する場合のみ、宛先が未作成のとき）:
  - `~/.local/state/em-ai-team/{data,secure}` → `.../emther/{data,secure}`
  - `./.data`（起動時 cwd 基準の旧デフォルト）→ `.../emther/data`
  - `~/.local/state/em-ai-team-secure` → `.../emther/secure`

## ロードマップ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 0 | デフォルトデータパスの XDG 化＋旧配置からの移行 | 実装済み |
| 1 | Next.js `output: "standalone"` ＋ `emther` ランチャー | 実装済み |
| 2 | `doctor` / `backup`（`restore`）／ルート配布 README | 実装済み |
| 3 | CI から GitHub Release 成果物を作成 | 実装済み |

## 明示的にやらないこと

- npm 公開・単一バイナリ化・Electron/Tauri（必要性が出てから再検討）
- ホスト配布での Agent CLI 完全同梱の必須化（認証が個人単位のため。同梱は Docker 側の強み）

## セキュリティ上の注意（公開リポジトリ）

- `.env`・認証ディレクトリ・state 配下はコミットしない（既存の ignore を維持）。
- バックアップ対象は主に `data` + `secure`（`emther backup`）。アーカイブは個人情報を含むため取り扱いに注意。
- 本番インターネット公開は想定しない（認証なしの単一ユーザー向け）。ランチャー既定も localhost のみ。

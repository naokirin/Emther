# 配布・パッケージ化方針

個人の EM サポートツールとして、**GitHub 公開リポジトリから入手でき、利用者のマシン上にだけ機微データが残る**ことを目標にする。npm レジストリへの公開はしない。

関連実装: `web/src/lib/persistence.ts`（データパス）、`scripts/em-ai-team`（ランチャー）、ルート `README.md`（配布手順）、`docs/docker.md`（隔離プロファイル）。

## 製品像

| レイヤ | 置き場所 | 備考 |
| --- | --- | --- |
| ソース | GitHub（公開） | clone して `./scripts/em-ai-team install` |
| アプリ本体 | `~/.local/share/em-ai-team/app` | Next.js standalone（webpack ビルド） |
| 起動コマンド | `~/.local/bin/em-ai-team` | install / build / start / stop / status / doctor / backup / restore |
| 業務データ | `~/.local/state/em-ai-team/data` | SQLite・JSON。リポジトリ外必須 |
| 実名対応表 | `~/.local/state/em-ai-team/secure` | 0700 / 0600。data と兄弟だが権限分離 |
| バックアップ | `~/.local/state/em-ai-team/backups` | `em-ai-team backup` が作成 |
| モデルキャッシュ | `~/.cache/huggingface` 等（将来は `~/.cache/em-ai-team` も検討） | アプリ本体に同梱しない |
| Agent CLI | 利用者ホスト（必須: `claude`） | `agy` / `cursor-agent` は任意 |
| 隔離実行 | Docker Compose（任意） | 認証・依存ごとコンテナに閉じたい人向け |

**同梱しないもの:** API キー、people-directory、モデル重み。認証と初回ダウンロードは利用者各自。

## ホストインストール（現行）

前提: Node 24+、（Agent Run を使うなら）ホストに `claude` CLI。手順の正本はリポジトリ直下の `README.md`。

```bash
git clone <このリポジトリの URL>
cd em_ai_team
./scripts/em-ai-team install
em-ai-team start
em-ai-team doctor
em-ai-team backup
```

- 既定で **127.0.0.1** のみにバインドする（LAN 公開しない）。
- standalone ビルドは `npm run build:standalone`（`next build --webpack`）。Turbopack 既定ビルドだと `serverExternalPackages`（transformers / onnx）が欠ける既知問題があるため。
- UI フォントは `@fontsource/*` を npm 同梱し、ビルド時に Google Fonts へネットワークしない。
- Docker 用の `npm run build` はそのまま（フル `node_modules` + `next start`）。standalone 成果物は使わない。

## 入手チャネル

1. **主経路:** 公開リポジトリを clone → `./scripts/em-ai-team install`（`README.md`）
2. **GitHub Releases:** 将来、standalone 成果物と checksum を添付（Phase 3）
3. **npm 公開:** しない（`npx` も主経路にしない）
4. **Docker:** セカンドクラス。手順は `docs/docker.md`

## データパス規約（Phase 0）

デフォルト（環境変数未設定時）:

```text
~/.local/state/em-ai-team/data/     # EM_DATA_DIR で上書き可
~/.local/state/em-ai-team/secure/   # EM_SECURE_DATA_DIR で上書き可
```

- 開発・テスト・Docker は従来どおり環境変数で差し替える。
- リポジトリ配下の `web/.data` には**新規書き込みしない**（公開 clone 作業ツリーと機微データの混在を防ぐ）。
- 旧配置からの一度きりの移行（存在する場合のみ、宛先が未作成のとき）:
  - `./.data`（起動時 cwd 基準の旧デフォルト）→ `.../em-ai-team/data`
  - `~/.local/state/em-ai-team-secure` → `.../em-ai-team/secure`

## ロードマップ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 0 | デフォルトデータパスの XDG 化＋旧配置からの移行 | 実装済み |
| 1 | Next.js `output: "standalone"` ＋ `em-ai-team` ランチャー | 実装済み |
| 2 | `doctor` / `backup`（`restore`）／ルート配布 README | 実装済み |
| 3 | CI から GitHub Release 成果物を作成 | 未着手 |

## 明示的にやらないこと

- npm 公開・単一バイナリ化・Electron/Tauri（必要性が出てから再検討）
- ホスト配布での Agent CLI 完全同梱の必須化（認証が個人単位のため。同梱は Docker 側の強み）

## セキュリティ上の注意（公開リポジトリ）

- `.env`・認証ディレクトリ・state 配下はコミットしない（既存の ignore を維持）。
- バックアップ対象は主に `data` + `secure`（`em-ai-team backup`）。アーカイブは個人情報を含むため取り扱いに注意。
- 本番インターネット公開は想定しない（認証なしの単一ユーザー向け）。ランチャー既定も localhost のみ。

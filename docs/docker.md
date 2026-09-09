# Docker で動かす（コンテナ完結）

このリポジトリの Web アプリ（Next.js）と Agent Runtime（`claude` / 任意で `agy`・`cursor-agent`）を、**ホストの認証ディレクトリをマウントせず**にコンテナ内で完結させる手順です。

## できること / できないこと

| 項目 | 状態 |
| --- | --- |
| Dashboard / Issue / Journal / Org 等の UI | コンテナ内で動作 |
| 永続化（SQLite・JSON・people-directory） | named volume |
| Agent Run（主経路: Claude CLI） | コンテナ内 CLI + **初回コンテナ内認証** |
| Gemini / Cursor フォールバック | イメージに同梱を試みる。認証は別途。Settings で ON にしたときだけ使う |
| ホストの `~/.claude` を流用 | **しない**（設計上あえて分離） |

## 前提

- **Docker Desktop（または Docker Engine）が起動していること**
- Docker Compose v2
- メモリ **8GB 以上をコンテナに割り当て可能**なこと（Quick Journal のローカル 0.5B + 埋め込みモデル）
- Claude Pro/Max 等のサブスクリプション、または `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`

## クイックスタート

```bash
# 1. ビルド＆起動
./scripts/docker-up.sh

# 2. Claude 認証（必須・対話。ブラウザはホスト側）
./scripts/docker-auth.sh claude

# 3. 状態確認
./scripts/docker-status.sh

# 4. ブラウザで開く
open http://localhost:3000
```

停止:

```bash
./scripts/docker-down.sh
```

データと認証 volume をまとめて消す場合のみ:

```bash
docker compose down -v
```

## 認証の考え方

- 認証情報は次の **Docker named volume** にだけ保存されます（ホストのホームはマウントしません）。
  - `em-claude-auth` → `/home/em/.claude`
  - `em-agy-auth` → `/home/em/.gemini`
  - `em-cursor-auth` → `/home/em/.cursor`
  - `em-cursor-config` → `/home/em/.config/cursor`
- アプリデータ:
  - `em-data` → `/data`（`EM_DATA_DIR`）
  - `em-secure` → `/secure`（`EM_SECURE_DATA_DIR` / people-directory）
  - `em-hf-cache` → Hugging Face モデルキャッシュ

### Claude（必須）

```bash
./scripts/docker-auth.sh claude
```

コンテナ内で `claude` の対話セッションが開きます。案内に従いログイン（または `/login`）し、終わったら `/exit` してください。

**Tips**

- OAuth の URL はホストのブラウザで開きます。
- Cursor / VS Code 内で別の Claude Code が同じターミナルを占有していると、認証 TUI が真っ白になることがあります。**通常の Terminal.app / iTerm** からスクリプトを実行してください。
- 対話の代わりに、リポジトリ直下の `.env` に `ANTHROPIC_API_KEY` または `CLAUDE_CODE_OAUTH_TOKEN` を書いて `docker compose up -d` しても構いません（例は `.env.docker.example`）。

### agy / Cursor（任意）

Settings でフォールバックを有効にする場合のみ:

```bash
./scripts/docker-auth.sh agy
./scripts/docker-auth.sh cursor
```

Cursor は `CURSOR_API_KEY` を `.env` に置く方法でも認証できます。

## サポートスクリプト

| スクリプト | 役割 |
| --- | --- |
| `scripts/docker-up.sh` | ビルドして起動 |
| `scripts/docker-down.sh` | 停止（volume は残す） |
| `scripts/docker-auth.sh` | コンテナ内 CLI 認証 |
| `scripts/docker-status.sh` | プロセス・CLI・認証痕跡・HTTP |
| `scripts/docker-shell.sh` | コンテナに bash で入る |

## 構成ファイル

- `docker-compose.yml` — サービス定義と volume
- `web/Dockerfile` — Node 24 + アプリ + CLI
- `web/docker-entrypoint.sh` — 起動時の未認証警告
- `.env.docker.example` — ポート / API キー例

## トラブルシューティング

### Agent Run がすぐ error になる

1. `./scripts/docker-status.sh` で `claude` の有無と auth volume を確認
2. 未認証なら `./scripts/docker-auth.sh claude` をやり直す
3. ログ: `docker compose logs -f web`

### ビルドで agy / Cursor のインストールが WARN になる

Claude 主経路だけで Agent Run は動きます。フォールバックが必要なら、`./scripts/docker-shell.sh` から公式インストーラを再実行し、イメージを作り直してください。

### Quick Journal が遅い / OOM

初回はモデルダウンロードのため数十秒かかることがあります。コンテナメモリを 8GB 未満にしていると落ちやすいです（`docker-compose.yml` の `mem_limit`）。

### ポートを変えたい

```bash
cp .env.docker.example .env
# EM_PORT=3001 などに変更
./scripts/docker-up.sh
```

## セキュリティ上の注意

- named volume 内の認証トークンと `em-secure`（実名対応表）は機微情報です。`docker compose down -v` や volume のバックアップ取り扱いに注意してください。
- この構成でも、Cursor フォールバックを有効にした場合の「絶対パス指定でのファイル読み取り」リスク（`web/README.md` 記載）は、ホスト実行時と同様に残ります。Docker 化したからといってそのリスクが消えるわけではありません。
- 本番インターネット公開は想定していません（認証なしの単一ユーザー向け MVP）。

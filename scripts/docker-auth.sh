#!/usr/bin/env bash
# コンテナ内でエージェント CLI の初回認証を行う。
# ホストの ~/.claude 等はマウントせず、compose の named volume にだけ保存する。
#
# Usage:
#   ./scripts/docker-auth.sh claude   # 必須（Agent Run の主経路）
#   ./scripts/docker-auth.sh agy      # 任意（Settings で有効化したとき）
#   ./scripts/docker-auth.sh cursor   # 任意（Settings で有効化したとき）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-}"
if [[ -z "${TARGET}" ]]; then
  echo "Usage: $0 {claude|agy|cursor}"
  exit 1
fi

if ! docker compose ps --status running --services 2>/dev/null | grep -qx web; then
  echo "web サービスが起動していません。先に ./scripts/docker-up.sh を実行してください。"
  exit 1
fi

echo ""
echo "注意:"
echo "  - ブラウザはホスト側で開き、表示された URL / コードを使って認証します。"
echo "  - Cursor / VS Code 内で別の Claude Code セッションが占有しているターミナルだと"
echo "    TUI が真っ白になることがあるため、通常の Terminal.app / iTerm 推奨です。"
echo ""

case "${TARGET}" in
  claude)
    echo "==> Claude CLI 認証（コンテナ内・volume: em-claude-auth）"
    echo "    対話セッションが開いたら /login を実行するか、案内に従ってログインしてください。"
    echo "    終わったら /exit で抜けてください。"
    docker compose exec -it web bash -lc 'claude'
    ;;
  agy)
    echo "==> agy（Antigravity）認証（コンテナ内・volume: em-agy-auth）"
    echo "    初回起動の案内に従ってログインし、終わったら終了してください。"
    docker compose exec -it web bash -lc 'agy'
    ;;
  cursor)
    echo "==> Cursor CLI 認証（コンテナ内・volume: em-cursor-auth）"
    echo "    login / auth サブコマンドを試します（バージョンにより名前が違います）。"
    docker compose exec -it web bash -lc '
      if command -v cursor-agent >/dev/null 2>&1; then
        cursor-agent login 2>/dev/null || cursor-agent auth 2>/dev/null || cursor-agent
      elif command -v agent >/dev/null 2>&1; then
        agent login 2>/dev/null || agent auth 2>/dev/null || agent
      else
        echo "cursor-agent / agent が見つかりません" >&2
        exit 1
      fi
    '
    ;;
  *)
    echo "Unknown target: ${TARGET}"
    echo "Usage: $0 {claude|agy|cursor}"
    exit 1
    ;;
esac

echo ""
echo "認証フローを終えました。確認: ./scripts/docker-status.sh"

#!/usr/bin/env bash
# イメージをビルドしてバックグラウンド起動する。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.docker.example && ! -f .env ]]; then
  echo "ヒント: cp .env.docker.example .env でポートや API キーを設定できます（任意）"
fi

echo "==> docker compose build / up"
docker compose up --build -d

echo ""
echo "起動しました: http://localhost:${EM_PORT:-3000}"
echo "初回は Agent Run 用の認証が必要です:"
echo "  ./scripts/docker-auth.sh claude"
echo "状態確認:"
echo "  ./scripts/docker-status.sh"

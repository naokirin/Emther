#!/usr/bin/env bash
# コンテナを停止する（named volume＝データ/認証は残る）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

docker compose down
echo "停止しました。データと認証 volume は保持されています。"
echo "volume ごと消す場合: docker compose down -v"

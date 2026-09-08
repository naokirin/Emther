#!/usr/bin/env bash
# 稼働中コンテナにシェルで入る（デバッグ用）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

docker compose exec -it web bash

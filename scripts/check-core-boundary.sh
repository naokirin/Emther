#!/usr/bin/env bash
# packages/core はフレームワーク非依存のドメイン層であることを保証する CI ガード。
# docs/2nd_architecture/plan.md フェーズ1.6（手動grepでの確認）の恒久化。
# フェーズ5.4（docs/2nd_architecture/checklist.md）参照。
set -euo pipefail

cd "$(dirname "$0")/.."

PATTERN='from "next/|from '"'"'next/|"use client"|from "@/components|from "@/app|from "@/lib'
MATCHES="$(grep -rlE "$PATTERN" packages/core/src || true)"

if [[ -n "$MATCHES" ]]; then
  echo "error: packages/core/src にフレームワーク依存のimportが見つかりました:" >&2
  echo "$MATCHES" >&2
  echo "packages/core はNext.js/UIフレームワークから独立したドメイン層である必要があります。" >&2
  exit 1
fi

echo "ok: packages/core/src にフレームワーク依存のimportはありません"

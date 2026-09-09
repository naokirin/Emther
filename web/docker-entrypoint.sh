#!/usr/bin/env bash
# コンテナ起動時の軽い健全性チェック。認証そのものは行わず、未認証なら案内だけ出す。
set -euo pipefail

mkdir -p "${EM_DATA_DIR:-/data}" "${EM_SECURE_DATA_DIR:-/secure}"
chmod 700 "${EM_SECURE_DATA_DIR:-/secure}" 2>/dev/null || true

echo "==> Emther / EM Support System (Docker)"
echo "    EM_DATA_DIR=${EM_DATA_DIR:-/data}"
echo "    EM_SECURE_DATA_DIR=${EM_SECURE_DATA_DIR:-/secure}"

claude_ready=0
if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  claude_ready=1
elif [[ -e "${HOME}/.claude/.credentials.json" || -e "${HOME}/.claude/credentials.json" ]]; then
  claude_ready=1
elif compgen -G "${HOME}/.claude/*" >/dev/null 2>&1; then
  # ログイン済みだと .credentials.json 以外の形で残るバージョンもある
  if find "${HOME}/.claude" -maxdepth 2 -type f 2>/dev/null | grep -qiE 'credential|oauth|session'; then
    claude_ready=1
  fi
fi

if [[ "${claude_ready}" -eq 0 ]]; then
  echo ""
  echo "⚠️  Claude CLI が未認証の可能性があります。"
  echo "   Agent Run を使う前に、ホスト側で次を実行してください:"
  echo "     ./scripts/docker-auth.sh claude"
  echo "   （フォールバック用）./scripts/docker-auth.sh agy"
  echo "   （フォールバック用）./scripts/docker-auth.sh cursor"
  echo ""
fi

exec "$@"

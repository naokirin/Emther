#!/usr/bin/env bash
# コンテナと CLI の有無・認証らしき痕跡を表示する（秘密は出さない）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> compose services"
docker compose ps || true

echo ""
echo "==> CLI binaries inside container"
docker compose exec -T web bash -lc '
  echo -n "claude: "; command -v claude || echo "(missing)"
  claude --version 2>/dev/null || true
  echo -n "agy: "; command -v agy || echo "(missing)"
  agy --version 2>/dev/null || true
  echo -n "cursor-agent: "; command -v cursor-agent || echo "(missing)"
  echo -n "agent: "; command -v agent || echo "(missing)"
  (cursor-agent --version 2>/dev/null || agent --version 2>/dev/null || true)
' 2>/dev/null || echo "(web が起動していない可能性があります)"

echo ""
echo "==> auth volume hints (存在有無のみ。中身は表示しません)"
docker compose exec -T web bash -lc '
  check_dir() {
    local label="$1" path="$2"
    if [[ ! -d "$path" ]]; then
      echo "$label: missing dir ($path)"
      return
    fi
    local count
    count="$(find "$path" -type f 2>/dev/null | wc -l | tr -d " ")"
    if [[ "$count" -gt 0 ]]; then
      echo "$label: present ($count files under $path)"
    else
      echo "$label: empty ($path) — ./scripts/docker-auth.sh が未実施の可能性"
    fi
  }
  check_dir "claude" "${HOME}/.claude"
  check_dir "agy" "${HOME}/.gemini"
  check_dir "cursor" "${HOME}/.cursor"
  if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then echo "ANTHROPIC_API_KEY: set"; fi
  if [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then echo "CLAUDE_CODE_OAUTH_TOKEN: set"; fi
  if [[ -n "${CURSOR_API_KEY:-}" ]]; then echo "CURSOR_API_KEY: set"; fi
' 2>/dev/null || true

echo ""
echo "==> HTTP"
curl -sS -o /dev/null -w "http://localhost:${EM_PORT:-3000} → HTTP %{http_code}\n" \
  "http://localhost:${EM_PORT:-3000}/" || echo "到達できません（起動直後はビルド待ちのことも）"

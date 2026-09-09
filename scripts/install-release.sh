#!/usr/bin/env bash
# GitHub Release の tarball からホストへインストールする（docs/packaging.md Phase 3）
# Usage:
#   ./scripts/install-release.sh emther-v0.1.0-linux-x64.tar.gz
#   # tarball 内の ./install.sh からも同じスクリプトが呼ばれる
set -euo pipefail

ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "Usage: install-release.sh <emther-*.tar.gz>" >&2
  exit 1
fi

APP_NAME="emther"
SHARE_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN_HOME="${XDG_BIN_HOME:-$HOME/.local/bin}"
APP_DIR="${EM_APP_DIR:-$SHARE_HOME/$APP_NAME/app}"
META_DIR="$SHARE_HOME/$APP_NAME"

tmp="$(mktemp -d)"
# shellcheck disable=SC2064
trap "rm -rf '$tmp'" EXIT

echo "==> extract $ARCHIVE"
tar -C "$tmp" -xzf "$ARCHIVE"
if [[ ! -f "$tmp/emther/app/server.js" ]]; then
  echo "error: アーカイブに emther/app/server.js がありません" >&2
  exit 1
fi

echo "==> install app → $APP_DIR"
mkdir -p "$APP_DIR"
find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$tmp/emther/app"/. "$APP_DIR"/
if [[ ! -f "$APP_DIR/server.js" ]]; then
  echo "error: インストールに失敗しました（$APP_DIR/server.js がありません。ディスク容量も確認してください）" >&2
  exit 1
fi

mkdir -p "$BIN_HOME" "$META_DIR"
if [[ -f "$tmp/emther/bin/emther" ]]; then
  cp -a "$tmp/emther/bin/emther" "$BIN_HOME/emther"
  chmod +x "$BIN_HOME/emther"
  echo "ランチャー: $BIN_HOME/emther"
  cat >"$BIN_HOME/em-ai-team" <<'EOF'
#!/usr/bin/env bash
echo "warning: 'em-ai-team' は 'emther' に改名されました。今後は emther を使ってください。" >&2
exec emther "$@"
EOF
  chmod +x "$BIN_HOME/em-ai-team"
fi

if [[ -f "$tmp/emther/VERSION" ]]; then
  cp -a "$tmp/emther/VERSION" "$META_DIR/VERSION"
  echo "VERSION:"
  cat "$META_DIR/VERSION"
fi

if ! echo ":$PATH:" | grep -q ":$BIN_HOME:"; then
  echo "注意: $BIN_HOME が PATH にありません。シェル設定に追加してください。"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "警告: node が見つかりません。起動には Node 24+ が必要です。" >&2
fi

echo ""
echo "完了。次のコマンドで起動できます:"
echo "  emther doctor"
echo "  emther start"

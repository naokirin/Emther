#!/usr/bin/env bash
# apps/server（Hono, esbuildバンドル）+ apps/web（Vite）をステージング／tarball化する
# （docs/2nd_architecture/plan.md フェーズ4.4。旧Next.js standaloneビルドの後継）
# emther build と GitHub Actions Release の両方から使う。
#
# Usage:
#   ./scripts/package-standalone.sh --dest ~/.local/share/emther/app
#   ./scripts/package-standalone.sh --tarball dist/emther-v0.1.0-linux-x64.tar.gz
#   ./scripts/package-standalone.sh --dest /tmp/app --skip-build   # 既存の apps/server/dist・apps/web/dist/client を使う
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || realpath "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
ROOT="${EM_SOURCE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

DEST=""
TARBALL=""
SKIP_BUILD=0
VERSION="${EM_PACKAGE_VERSION:-dev}"
PLATFORM="${EM_PACKAGE_PLATFORM:-}"

usage() {
  cat <<EOF
Usage: package-standalone.sh [options]

Options:
  --dest DIR         Stage app files into DIR (replaces contents)
  --tarball PATH     Write release tarball (contains app/ + bin/emther)
  --skip-build       Reuse existing apps/server/dist + apps/web/dist/client (do not npm ci / build)
  --root DIR         Repository root (default: parent of scripts/, or EM_SOURCE_ROOT)
  --version VER      Embedded VERSION string (default: EM_PACKAGE_VERSION or "dev")
  --platform ID      Platform id in metadata (e.g. linux-x64); default: auto
  -h, --help         Show help

Requires at least one of --dest or --tarball.
EOF
}

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
  esac
  case "$os" in
    linux) echo "linux-${arch}" ;;
    darwin) echo "darwin-${arch}" ;;
    *) echo "${os}-${arch}" ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)
      DEST="${2:?}"
      shift 2
      ;;
    --tarball)
      TARBALL="${2:?}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --root)
      ROOT="${2:?}"
      shift 2
      ;;
    --version)
      VERSION="${2:?}"
      shift 2
      ;;
    --platform)
      PLATFORM="${2:?}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$DEST" && -z "$TARBALL" ]]; then
  echo "error: --dest または --tarball が必要です" >&2
  usage >&2
  exit 1
fi

if [[ ! -f "$ROOT/apps/server/package.json" || ! -f "$ROOT/apps/web/package.json" ]]; then
  echo "error: $ROOT/apps/{server,web}/package.json がありません（--root / EM_SOURCE_ROOT を確認）" >&2
  exit 1
fi

if [[ -z "$PLATFORM" ]]; then
  PLATFORM="$(detect_platform)"
fi

SERVER_DIR="$ROOT/apps/server"
WEB_DIR="$ROOT/apps/web"
SERVER_JS="$SERVER_DIR/dist/server.js"
CLIENT_DIST="$WEB_DIR/dist/client"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "error: node が見つかりません（Node 24+）" >&2
    exit 1
  fi
  echo "==> dependencies ($ROOT, npm workspaces)"
  (
    cd "$ROOT"
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  )
  echo "==> server build (esbuild → dist/server.js)"
  (
    cd "$SERVER_DIR"
    npm run build
  )
  echo "==> client build (vite build → dist/client)"
  (
    cd "$WEB_DIR"
    npm run build
  )
fi

if [[ ! -f "$SERVER_JS" ]]; then
  echo "error: $SERVER_JS がありません。先に (cd apps/server && npm run build) を実行してください。" >&2
  exit 1
fi
if [[ ! -f "$CLIENT_DIST/index.html" ]]; then
  echo "error: $CLIENT_DIST/index.html がありません。先に (cd apps/web && npm run build) を実行してください。" >&2
  exit 1
fi

stage_app_into() {
  local dest="$1"
  echo "==> stage app → $dest"
  mkdir -p "$dest"
  find "$dest" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a "$SERVER_JS" "$dest/server.js"

  mkdir -p "$dest/client"
  cp -a "$CLIENT_DIST"/. "$dest/client"/

  # docs/2nd_architecture/plan.md フェーズ4.1・4.4: esbuildバンドルは
  # @huggingface/transformers・onnxruntime-node・kuromojiをexternal指定しており
  # バンドルに含まれないため、実行時に解決できるようnode_modulesへ個別配置する。
  # @vercel/nft でdist/server.jsの実際のrequire/importグラフを辿り、
  # transformers・onnxruntime-node/common本体に加え、それらが依存する
  # ホイストされた兄弟パッケージ（例: sharpが使うdetect-libc）も漏れなく解決する
  # （scripts/trace-server-deps.mjs参照。2026-09-20実機smoke testで
  # `Cannot find module 'detect-libc'` を発見・この対応で解消済み）。
  node "$ROOT/scripts/trace-server-deps.mjs" "$SERVER_JS" "$ROOT" "$dest"

  # kuromojiはcreateRequire経由の動的require（nftの静的解析では検出不可）+
  # 辞書データ（dict/、JSのrequire/importグラフに乗らない）を含むため、
  # ディレクトリまるごとを別途コピーする。
  kuromoji_src=""
  if [[ -e "$SERVER_DIR/node_modules/kuromoji" ]]; then
    kuromoji_src="$SERVER_DIR/node_modules/kuromoji"
  elif [[ -e "$ROOT/node_modules/kuromoji" ]]; then
    kuromoji_src="$ROOT/node_modules/kuromoji"
  fi
  if [[ -z "$kuromoji_src" ]]; then
    echo "error: kuromoji が node_modules に見つかりません" >&2
    exit 1
  fi
  mkdir -p "$dest/node_modules"
  rm -rf "$dest/node_modules/kuromoji"
  cp -a "$kuromoji_src" "$dest/node_modules/kuromoji"

  if [[ ! -f "$dest/server.js" ]]; then
    echo "error: staging に失敗しました（server.js なし）" >&2
    exit 1
  fi
}

if [[ -n "$DEST" ]]; then
  stage_app_into "$DEST"
fi

if [[ -n "$TARBALL" ]]; then
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT
  mkdir -p "$tmp/emther/app" "$tmp/emther/bin"
  stage_app_into "$tmp/emther/app"
  cp -a "$ROOT/scripts/emther" "$tmp/emther/bin/emther"
  chmod +x "$tmp/emther/bin/emther"
  if [[ -f "$ROOT/scripts/install-release.sh" ]]; then
    cp -a "$ROOT/scripts/install-release.sh" "$tmp/emther/install.sh"
    chmod +x "$tmp/emther/install.sh"
  fi
  {
    echo "version=$VERSION"
    echo "platform=$PLATFORM"
    echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$tmp/emther/VERSION"
  cat >"$tmp/emther/README.txt" <<EOF
Emther (EM Support System) — prebuilt package ($VERSION / $PLATFORM)

Install:
  ./install.sh
  # 展開済みディレクトリ（app/ が隣にある）からホストへコピーします。
  # tarball を直接渡す場合: emther install-release emther-vX.Y.Z-<platform>.tar.gz

Then:
  emther doctor
  emther start

Requires Node.js 24+ on PATH. Data stays under ~/.local/state/emther/.
See this repository's README.md for details.
EOF

  mkdir -p "$(dirname "$TARBALL")"
  tar -C "$tmp" -czf "$TARBALL" emther
  echo "tarball: $TARBALL"
fi

echo "done (version=$VERSION platform=$PLATFORM)"

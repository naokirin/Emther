# Emther (EM Support System) — コンテナ完結イメージ
# Node 24 LTS（node:sqlite）+ Claude / agy / cursor-agent CLI を同梱する。
# 認証情報はイメージに焼き込まず、実行時の named volume に保存する。
#
# ビルドコンテキストはリポジトリルート（docker-compose.yml の context: . を参照）。
# apps/server（Hono、esbuild）+ apps/web（Vite）構成（docs/2nd_architecture/plan.md
# フェーズ4）。npm workspaces のため root で npm ci する。Docker はセカンドクラスの
# 隔離プロファイルであり、ホスト配布（scripts/package-standalone.sh）のような
# node_modules の最小トレースはせず、シンプルに `npm prune --omit=dev` した
# フル node_modules をそのまま同梱する。

FROM node:24-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json ./packages/core/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

FROM node:24-bookworm AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -w @emther/server
RUN npm run build -w @emther/web
# 本番実行に不要な devDependencies を落とす（transformers / onnx の native は残る）
RUN npm prune --omit=dev

FROM node:24-bookworm AS runner
WORKDIR /app

ENV NODE_ENV=production
# apps/server はデフォルト 127.0.0.1 バインドのため、コンテナ外からの到達には
# 0.0.0.0 が必要（docs/2nd_architecture/plan.md フェーズ4.3のPORT/HOSTNAME参照）。
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV EM_DATA_DIR=/data
ENV EM_SECURE_DATA_DIR=/secure
# コンテナ内ではホスト keyring が無いため、agy の自動更新を止めて安定運用する
ENV AGY_CLI_DISABLE_AUTO_UPDATE=true
# Hugging Face キャッシュ（モデル重み）を volume 化しやすい場所へ
ENV HF_HOME=/home/em/.cache/huggingface
ENV TRANSFORMERS_CACHE=/home/em/.cache/huggingface

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep \
  && rm -rf /var/lib/apt/lists/*

# 非 root ユーザー（Claude Code の Docker 認証も非 root を推奨）
RUN useradd --create-home --shell /bin/bash --uid 1000 em \
  && mkdir -p /data /secure /home/em/.claude /home/em/.gemini \
    /home/em/.cursor /home/em/.config/cursor /home/em/.cache/huggingface \
    /home/em/.local/bin \
  && chown -R em:em /data /secure /home/em /app

# Claude Code CLI（アプリの主経路。PATH 上の `claude` を spawn する）
RUN npm install -g @anthropic-ai/claude-code \
  && claude --version

# agy / Cursor CLI はホーム配下に入るインストーラが多いので em で入れ、
# バイナリだけ /usr/local/bin へ固定コピーして volume マウントの影響を受けないようにする。
USER em
ENV HOME=/home/em
ENV PATH="/home/em/.local/bin:/usr/local/bin:${PATH}"
# フォールバック CLI。インストーラ仕様変更で失敗しても Claude 主経路は残す。
RUN set +e; \
  curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/agy-install.sh \
    && bash /tmp/agy-install.sh; \
  agy_rc=$?; \
  curl -fsS https://cursor.com/install -o /tmp/cursor-install.sh \
    && bash /tmp/cursor-install.sh; \
  cursor_rc=$?; \
  if [ "$agy_rc" -ne 0 ]; then echo "WARN: agy install failed (rc=$agy_rc)"; fi; \
  if [ "$cursor_rc" -ne 0 ]; then echo "WARN: Cursor CLI install failed (rc=$cursor_rc)"; fi; \
  exit 0

USER root
RUN set -eu; \
  if [ -x /home/em/.local/bin/agy ]; then cp -a /home/em/.local/bin/agy /usr/local/bin/agy; fi; \
  if [ -x /home/em/.local/bin/agent ]; then cp -a /home/em/.local/bin/agent /usr/local/bin/agent; fi; \
  if [ -x /home/em/.local/bin/cursor-agent ]; then \
    cp -a /home/em/.local/bin/cursor-agent /usr/local/bin/cursor-agent; \
  elif [ -x /usr/local/bin/agent ]; then \
    ln -sf /usr/local/bin/agent /usr/local/bin/cursor-agent; \
  fi; \
  command -v claude; \
  command -v agy || echo "WARN: agy not on PATH"; \
  command -v cursor-agent || command -v agent || echo "WARN: cursor-agent/agent not on PATH"

COPY --from=builder --chown=em:em /app/apps/server/dist/server.js ./server.js
COPY --from=builder --chown=em:em /app/apps/web/dist/client ./client
COPY --from=builder --chown=em:em /app/node_modules ./node_modules
COPY --chown=em:em docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER em
WORKDIR /app
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]

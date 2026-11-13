# syntax=docker/dockerfile:1.7
# tirisfal 自托管镜像：容器内跑 wrangler dev --local（workerd）+ D1/R2/DO 本地绑定
# 构建：docker build -f docker/Dockerfile -t tirisfal:local .

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
COPY package.json package-lock.json ./
# wrangler / vite / preact 都在 devDependencies：必须显式包含
RUN npm ci --include=dev --no-audit
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl ca-certificates sqlite3 util-linux \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    HOME=/data \
    WRANGLER_HOME=/data/.wrangler \
    WRANGLER_SEND_METRICS=false \
    TMPDIR=/tmp

# 运行时需要 wrangler（devDependency）与 workerd，因此整包复制
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json wrangler.toml tsconfig.json ./
COPY shared ./shared
COPY src ./src
COPY migrations ./migrations
COPY docker ./docker

# 构建上下文里的文件可能是 600（不同 umask/检出方式），统一补读权限；
# 只处理源码/静态资源，不碰 node_modules 的十万级文件
RUN chmod a+r /app/wrangler.toml /app/package.json /app/tsconfig.json \
 && chmod -R a+rX /app/src /app/shared /app/migrations /app/docker /app/dist

# 只改数据卷属主；/app 对所有人只读即可，避免 chown 数十万文件的 node_modules
RUN useradd --uid 10001 --user-group --create-home --home-dir /data --shell /usr/sbin/nologin tirisfal \
 && mkdir -p /data \
 && chown 10001:10001 /data \
 && chmod 0755 /app/docker/docker-entrypoint.sh /app/docker/cron-tick.mjs

USER 10001
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8787/api/health >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/docker-entrypoint.sh"]

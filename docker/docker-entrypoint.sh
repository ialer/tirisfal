#!/bin/sh
# tirisfal 容器入口：校验密钥 -> 渲染运行配置 -> 跑迁移 -> 起 workerd -> 起 cron tick
set -eu
umask 077

# wrangler 装在 /app/node_modules/.bin，不在默认 PATH
export PATH="/app/node_modules/.bin:${PATH}"

RUNTIME_DIR=${RUNTIME_DIR:-/data/runtime}
STATE_DIR=${STATE_DIR:-/data/state}
PORT=${PORT:-8787}
SECRETS_FILE=${TIRISFAL_SECRETS_FILE:-/run/secrets/dev.vars}

log() { printf '[entrypoint] %s\n' "$*"; }
fail() { printf '[entrypoint] ERROR: %s\n' "$*" >&2; exit 1; }

mkdir -p "$RUNTIME_DIR" "$STATE_DIR" "$RUNTIME_DIR/migrations" /data/backups

# ---------- 1. 密钥：文件挂载，绝不走 environment（docker inspect 可见） ----------
if [ ! -r "$SECRETS_FILE" ]; then
  fail "secrets file not readable: $SECRETS_FILE (on host: sudo chown 10001:10001 <file> && chmod 600 <file>)"
fi
cp "$SECRETS_FILE" "$RUNTIME_DIR/.dev.vars"
chmod 600 "$RUNTIME_DIR/.dev.vars"

for key in JWT_SECRET ENCRYPTION_KEY; do
  grep -qE "^${key}=.+" "$RUNTIME_DIR/.dev.vars" || fail "missing ${key} in $SECRETS_FILE"
done

if grep -q '^JWT_SECRET=Enter-your-JWT-key-here-at-least-32-characters$' "$RUNTIME_DIR/.dev.vars"; then
  fail "JWT_SECRET still uses the example value from .dev.vars.example"
fi

if grep -qE '^(JWT_SECRET|ENCRYPTION_KEY)=REPLACE_ME' "$RUNTIME_DIR/.dev.vars"; then
  fail "secrets file still contains REPLACE_ME placeholders"
fi

awk -F= '/^JWT_SECRET=/{ if (length($2) < 32) exit 1 }' "$RUNTIME_DIR/.dev.vars" \
  || fail "JWT_SECRET must be at least 32 characters"
awk -F= '/^ENCRYPTION_KEY=/{ if (length($2) < 16) exit 1 }' "$RUNTIME_DIR/.dev.vars" \
  || fail "ENCRYPTION_KEY must be at least 16 characters"

# ---------- 2. 运行配置：相对路径改绝对，rootfs 保持只读 ----------
sed -e 's|^main = "src/index.ts"|main = "/app/src/index.ts"|' \
    -e 's|^directory = "./dist"|directory = "/app/dist"|' \
    /app/wrangler.toml > "$RUNTIME_DIR/wrangler.toml"
cp -a /app/migrations/. "$RUNTIME_DIR/migrations/"

cd "$RUNTIME_DIR"

# ---------- 3. 迁移：幂等（d1_migrations 账本），失败即退出 ----------
# wrangler 4.71 在「无待应用迁移」时会打印完成后不退出（挂住），
# 因此：先看账本，只有缺迁移才调它；调用带 timeout，并以账本+表结构复验为准。
EXPECTED=$(ls /app/migrations/*.sql | wc -l)

applied_count() {
  db_file=$(ls "$STATE_DIR"/v3/d1/*/*.sqlite 2>/dev/null | head -n 1 || true)
  [ -n "$db_file" ] || { echo 0; return; }
  sqlite3 "$db_file" 'select count(*) from d1_migrations;' 2>/dev/null || echo 0
}

APPLIED=$(applied_count)
if [ "$APPLIED" -lt "$EXPECTED" ]; then
  log "applying D1 migrations ($APPLIED/$EXPECTED)"
  timeout 240 flock "$STATE_DIR/.migrate.lock" \
    wrangler d1 migrations apply DB --local --persist-to "$STATE_DIR" -c "$RUNTIME_DIR/wrangler.toml" < /dev/null || true
fi

APPLIED=$(applied_count)
[ "$APPLIED" -ge "$EXPECTED" ] || fail "migrations incomplete: $APPLIED/$EXPECTED applied"

db_file=$(ls "$STATE_DIR"/v3/d1/*/*.sqlite 2>/dev/null | head -n 1 || true)
[ -n "$db_file" ] || fail "D1 database file not found under $STATE_DIR"
sqlite3 "$db_file" "select 1 from users limit 1;" >/dev/null 2>&1 \
  || fail "schema check failed: users table missing"
log "migrations ready ($APPLIED/$EXPECTED)"

# ---------- 4. 定时任务 tick（wrangler dev 不会自己跑 cron） ----------
node /app/docker/cron-tick.mjs &
TICK_PID=$!

# ---------- 5. 启动 workerd ----------
log "starting worker on 0.0.0.0:$PORT"
wrangler dev /app/src/index.ts \
  -c "$RUNTIME_DIR/wrangler.toml" \
  --local --ip 0.0.0.0 --port "$PORT" \
  --persist-to "$STATE_DIR" \
  --test-scheduled \
  --show-interactive-dev-session=false \
  --log-level info &
WRANGLER_PID=$!

trap 'kill -TERM "$TICK_PID" "$WRANGLER_PID" 2>/dev/null || true' TERM INT
wait "$WRANGLER_PID"

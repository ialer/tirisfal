# Docker 自托管部署

> 适用版本：v1.6.0+（含 v3 密文格式与客户端 IP 信任链）
> 目标：在自建虚拟内网（EasyTier）里用一条 `docker compose` 跑起 tirisfal；公网只通过 Cloudflare Tunnel 暴露。

## 1. 架构

```
内网客户端 ──MagicDNS/虚拟IP──▶ Caddy:443（内部 CA, TLS）──┐
                                                          ├─▶ tirisfal:8787（workerd，仅容器网络）
公网客户端 ──▶ Cloudflare 边缘 ──tunnel──▶ Caddy:80 ───────┘
```

- **worker 端口不发布到宿主机**，只连容器网络；客户端 IP 由 Caddy 注入
- Caddy 可选（`--profile proxy`），cloudflared 可选（`--profile tunnel`）
- 数据全在命名卷 `tirisfal-data`（D1 sqlite、R2 目录、KV、DO）

## 2. 快速开始

```bash
cd docker
cp -n env.example .env
mkdir -p secrets
cp secrets/dev.vars.example secrets/dev.vars
# 容器以 uid 10001 运行，密钥文件必须对它可读
sudo chown 10001:10001 secrets/dev.vars
chmod 600 secrets/dev.vars
# 编辑 secrets/dev.vars，填真实 JWT_SECRET / ENCRYPTION_KEY
#   openssl rand -hex 32   -> JWT_SECRET
#   openssl rand -base64 32 -> ENCRYPTION_KEY

docker compose --profile proxy up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8787/api/health   # 容器内自检（如从宿主机执行需进容器）
```

首次启动顺序：校验密钥 → 渲染运行配置 → 应用 D1 迁移 → 起 workerd → 起 cron tick。
迁移失败容器不会变为 healthy，也不会接收流量。

## 3. 密钥：只走文件挂载

```
./secrets/dev.vars  ──挂载──▶  /run/secrets/dev.vars  ──entrypoint 复制──▶  /data/runtime/.dev.vars (0600)
```

**不要**把 `JWT_SECRET`/`ENCRYPTION_KEY` 放进 `environment:` 或 `env_file:`——`docker inspect` 会原样回显。
entrypoint 会拒绝示例密钥、`REPLACE_ME` 占位符和短于 32 字符的 `JWT_SECRET`。

## 4. 内网 TLS（Caddy 内部 CA）

- 证书保存在 `caddy-data` 卷，签发对象是 `.env` 里的 `TIRISFAL_HOST`
- 导出根证书给客户端信任：

```bash
docker compose run --rm --entrypoint sh caddy -c 'cat /data/caddy/pki/authorities/local/root.crt' > tirisfal-ca.crt
```

- 浏览器/客户端导入该根证书后，`https://<TIRISFAL_HOST>` 不再告警
- 只监听 `TIRISFAL_BIND_IP`（默认 100.100.1.1），宿主机端口由 `TIRISFAL_HTTPS_PORT`（默认 443）控制；
  改映射前先确认不会落到 0.0.0.0

## 5. Cloudflare Tunnel（公网唯一入口）

1. Cloudflare Zero Trust → Networks → Tunnels 建隧道，取 token
2. `docker/secrets/cf_tunnel_token`（0600）写入 token
3. 隧道 Public Hostname：`tirisfal.example.com` → `HTTP` → `caddy:80`
4. 启动：`docker compose --profile proxy --profile tunnel up -d`

CF 边缘终止 TLS 并注入 `CF-Connecting-IP`，Caddy 的 `:80` 段原样透传，不做覆盖。
如需在边缘再做一层身份校验，可在 CF Access 上给该 hostname 加策略（应用侧未内置 JWT 校验）。

## 6. 客户端 IP 信任链（403 排障第一条）

worker 拿不到 socket 对端地址，客户端 IP 只来自请求头：

| 变量 | 默认 | 说明 |
|---|---|---|
| `CLIENT_IP_HEADER` | `CF-Connecting-IP` | 反代注入的头名 |
| `PROXY_SHARED_SECRET` | 空 | 设置后，请求还必须带匹配的 `X-Tirisfal-Proxy` 头才被信任 |

没有可信 IP 时，公开接口返回 `403 需要客户端 IP`，`allowed_ip` 授权一律拒绝（fail-closed）。
默认部署靠「worker 端口不发布 + 只有 Caddy 在 edge 网络」保证头不可伪造；要再收紧就打开 `PROXY_SHARED_SECRET` 并在 Caddyfile 里加 `header_up X-Tirisfal-Proxy`。

## 7. 备份与恢复

D1 是本机 SQLite，备份就是拷文件（先 checkpoint）：

```bash
docker compose exec tirisfal sh -c 'mkdir -p /data/backups && sqlite3 /data/state/v3/d1/*/*.sqlite ".backup /data/backups/d1-$(date +%F-%H%M%S).sqlite"'
docker run --rm -v tirisfal_tirisfal-data:/data -v "$PWD":/backup alpine \
  sh -c 'cd /data && tar czf /backup/tirisfal-data-$(date +%F).tgz state'
```

恢复：停容器 → 用备份覆盖卷内 `state` → 起容器。恢复演练建议在临时卷上做一次登录 + 凭证读取。

## 8. 升级与回滚

```bash
docker compose pull        # 或改 .env 里 TIRISFAL_IMAGE 的 tag
docker compose up -d       # 启动时自动补跑新增迁移
```

- 迁移只允许 additive DDL；失败会停在 healthy 之前
- **回滚红线**：v1.6.0 起密文是 v3 格式，旧镜像读不了。回滚前先导出凭证，或用备份恢复数据卷

## 9. 定时任务

`wrangler dev` 不执行 `[triggers] crons`，容器内 `cron-tick.mjs` 每 5 分钟对齐触发 `/__scheduled`。
备份与审计清理自带「到期才执行」判断，重复触发安全。
**不要 `--scale tirisfal=2`**：本地 SQLite 单写者，且定时任务会重复执行。

## 10. 排障

| 现象 | 原因 / 处理 |
|---|---|
| 注册/登录 403「需要客户端 IP」 | 走的是反代但没注入 `CF-Connecting-IP`；检查 Caddyfile `header_up` 与 `CLIENT_IP_HEADER` |
| 容器 restart 循环，日志 `secrets file not readable` | 宿主文件属主/权限问题：`sudo chown 10001:10001 docker/secrets/dev.vars && chmod 600` |
| 日志 `missing ENCRYPTION_KEY` | `secrets/dev.vars` 里缺变量，或挂载到了空目录 |
| `database not initialized` | 迁移失败；看 entrypoint 输出里 `d1 migrations apply` 那一段 |
| 启动报只读文件系统 | 有写入落到了 /app；确认 `HOME/WRANGLER_HOME/TMPDIR` 仍指向 `/data` 与 `/tmp` |
| 内网 HTTPS 证书告警 | 客户端未信任 Caddy 内部 CA，见第 4 节 |
| 隧道 502 | Public Hostname 指向了 `https://caddy`；应指向 `http://caddy:80` |
| 附件上传失败 | `LIMITS.attachment.maxFileSizeBytes` 为 100MB，反代与 CF 侧也有上限 |

## 11. 安全基线（compose 已内置）

- `read_only: true` + `/tmp` tmpfs（noexec,nosuid）
- `cap_drop: ALL`、`no-new-privileges`
- 非 root（uid 10001）
- worker 端口只在内部网络，宿主机不发布
- 密钥只经文件挂载，不进镜像层、不进 `docker inspect`
- 页面不引用第三方源（字体已自托管），CSP 收紧为 `default-src 'self'`

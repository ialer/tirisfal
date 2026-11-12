<p align="center">
  <strong>简体中文</strong> · <a href="README_EN.md">English</a>
</p>

# tirisfal

> **给 AI Agent 用的凭证网关，顺带一个 Bitwarden 兼容密码库。**

<p align="center">
  <img src="https://img.shields.io/badge/version-1.6.0-blue" alt="version">
  <img src="https://img.shields.io/badge/license-LGPL--3.0-green" alt="license">
  <img src="https://img.shields.io/badge/runtime-workerd%20%2F%20Cloudflare%20Workers-orange" alt="runtime">
  <img src="https://img.shields.io/badge/deploy-Cloudflare%20%7C%20Docker-2496ED" alt="deploy">
</p>

Agent 需要的不是「把 API Key 复制给它」，而是「让它能调用，但永远看不到真值」。
tirisfal 把这个能力做成服务端闭环：**鉴权 → 取密 → 注入上游 → 脱敏返回**，明文不出服务端、不进 Agent 上下文；审计记录 host/purpose/IP/UA 等元数据，不记明文。

密码库（Bitwarden 兼容）是配套：人和客户端继续用成熟生态，Agent 走凭证网关。

---

## 为什么需要它

| 现状 | 后果 |
|---|---|
| 把 Key 写进 Agent 的 env / prompt / 临时文件 | 一次日志、一次上下文外带就永久泄露 |
| 让 Agent 自己读 secrets manager | 每个 Agent 都要 SDK、权限模型和轮换逻辑，散落在各处 |
| 用通用 Vault 做注入 | 能力够但太重：HA、seal/unseal、策略 DSL，小团队维护不起 |

tirisfal 的答案是一条 HTTP 调用：

```bash
curl -X POST https://your-host/api/secrets/use \
  -H "Authorization: Bearer <machine-token>" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"<id>","name":"OPENAI_KEY","url":"https://api.openai.com/v1/chat/completions",
       "method":"POST","purpose":"chat completion","body":"{...}"}'
```

真值由服务端注入 `Authorization`，Agent 只拿到上游响应；若上游回显凭证，响应中的明文会被替换为 `***REDACTED***`。

---

## 三种凭证使用方式

| 模式 | Agent 拿到什么 | 适用 |
|---|---|---|
| **inject**（默认） | 只能调用白名单上游，拿不到真值 | 绝大多数场景 |
| **masked read** | 掩码 `sk-a****9f2c`，用于确认「配的是哪把钥匙」 | 排障、核对 |
| **reveal** | 明文，但绑定配额（默认 1 次，原子消耗），超限 429 | 迁移、一次性调试 |

授权粒度：machine account → project → grant。grant 可叠加 `allowed_hosts`（SSRF 白名单）、`allowed_ip`、`allowed_hours`、`max_requests_per_minute`、`reveal_limit`、`permission`（read / write）。

---

## 信任模型（必须分清的两套域）

| 域 | 加密位置 | 服务端能否解密 | 说明 |
|---|---|---|---|
| **密码库（vault）** | 客户端 | ❌ 不能 | 主密码经 PBKDF2 派生主密钥，服务端只存加密后的 user key 与校验器；零知识 |
| **凭证（Secrets Manager）** | 服务端 | ✅ 能（持 `ENCRYPTION_KEY`） | 注入代理必须在服务端拿到明文才能替你调用上游；这是设计前提，不是缺陷 |

一句话：**密码库是零知识的，Agent 凭证不是。** 如果你的场景要求 Agent 凭证也端到端加密，那注入代理就不成立——请直接用密码库模式或换工具。
细节与轮换边界见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

---

## 快速开始

### A. Cloudflare Workers

```bash
git clone https://github.com/ialer/tirisfal.git && cd tirisfal
npm install
cp .dev.vars.example .dev.vars

npx wrangler secret put JWT_SECRET        # openssl rand -hex 32
npx wrangler secret put ENCRYPTION_KEY    # openssl rand -base64 32（一旦使用不可更换）
npx wrangler d1 migrations apply tirisfal-db --remote
npm run deploy
```

### B. Docker 自托管（推荐内网/团队）

```bash
cd docker
cp -n env.example .env
mkdir -p secrets && cp secrets/dev.vars.example secrets/dev.vars
# 填 JWT_SECRET / ENCRYPTION_KEY，然后：
sudo chown 10001:10001 secrets/dev.vars && chmod 600 secrets/dev.vars

docker compose --profile proxy up -d --build     # 内网 TLS（Caddy 内部 CA）
docker compose --profile proxy --profile tunnel up -d   # 叠加 Cloudflare Tunnel
```

- 仅暴露 Caddy 的 443（默认绑 `100.100.1.1`），worker 端口不发布
- 密钥走文件挂载，不进 `docker inspect`
- 完整 runbook：**[docs/DOCKER.md](docs/DOCKER.md)**

---

## Agent 接入（四步）

```bash
API=https://your-host

# 1) 建机器账号
curl -X POST $API/api/machine-accounts -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" -d '{"name":"my-agent"}'

# 2) 签发令牌（只显示一次，库里只存 hash）
curl -X POST $API/api/machine-accounts/<id>/token -H "Authorization: Bearer <user-token>"

# 3) 建项目 + 写凭证
curl -X POST $API/api/projects -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" -d '{"name":"my-project"}'
curl -X POST $API/api/secrets -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"OPENAI_KEY","value":"sk-...","project_id":"<project-id>"}'

# 4) 授权（inject 模式 + 上游白名单）
curl -X POST $API/api/machine-accounts/<id>/projects/<project-id> \
  -H "Authorization: Bearer <user-token>" -H "Content-Type: application/json" \
  -d '{"permission":"read","mode":"inject","allowed_hosts":["api.openai.com"]}'
```

> 需要让 Agent 管理凭证（创建/更新/删除）时，授权 `permission` 必须显式为 `write`；
> `read` 授权只能读与注入，写操作一律 403。

---

## 与同类项目对比

| | tirisfal | Vaultwarden | HashiCorp Vault | Infisical / Doppler | AWS SM Agent |
|---|---|---|---|---|---|
| 密码库 | ✅ Bitwarden 兼容 | ✅ | ❌ | ❌ | ❌ |
| Agent 注入代理（真值不出服务端） | ✅ 内置 | ❌ | ⚠️ 需自建/模板 | ⚠️ 部分 | ❌（本地缓存） |
| 掩码读取 + 一次性 reveal 配额 | ✅ | ❌ | ⚠️ 策略实现 | ❌ | ❌ |
| 自托管成本 | 单容器 / 单 Worker | 单容器 | 高（HA/seal） | 中 | 云服务 |
| 运维复杂度 | 低 | 低 | 高 | 中 | 低 |

---

## 安全设计

- **密码库零知识**：客户端 PBKDF2-600k；服务端只做二次哈希校验
- **凭证加密**：v3 格式，每条密文独立 salt + HKDF-SHA-256（派生密钥不跨记录复用）；存量 v2/PBKDF2 密文读取时透明升级
- **TOTP 密钥**：同样以 v3 加密落库（`TOTP_SECRET` 优先，未设回退 `ENCRYPTION_KEY`）；存量明文在下次成功验证后透明升级
- **注入代理**：仅 https、拒绝 IP 字面量/私网/内网域名、`allowed_hosts` 单层通配、可选逐次 DoH 解析校验（`OUTBOUND_DNS_GUARD=1`）
- **响应脱敏**：任意长度凭证，覆盖原文/URL 编码/base64/base64url 变体；上游响应流式读取，超 512KB 截断
- **下载安全**：附件/Send 强制 `octet-stream` + `Content-Disposition: attachment` + sandbox CSP，杜绝同源 XSS
- **令牌**：JWT 强制 `typ=access`/`aud`/`alg=HS256`；machine token 只存 SHA-256；refresh 轮换 + 家族重用检测
- **限流**：固定窗口原子计数（换窗重置），public/登录/刷新/注册/grant 各自配额
- **客户端 IP 信任链**：只信可信代理注入的头，支持 `PROXY_SHARED_SECRET`；直连 worker 无法伪造
- **备份**：导出/导入字段契约校验、解压前限额（zip bomb）、凭证目录含 vault + SM（机器 token 不入备份）

---

## 架构

```
浏览器 / 官方客户端 ──▶ workerd（Workers 或容器内）──▶ D1 / R2 / Durable Objects
AI Agent ──machine token──▶ /api/secrets/use ──▶ 白名单上游（注入 + 脱敏）
```

- 运行时：workerd（Cloudflare Workers / 本地 `wrangler dev --local`）
- 存储：D1（SQLite）、R2（附件/归档）、Durable Objects（通知）
- 前端：Preact + Vite，字体自托管，CSP `default-src 'self'`
- 部署：Cloudflare 一键 `wrangler deploy`；或 Docker Compose（Caddy 内网 TLS + 可选 CF Tunnel）

---

## AI 生成的密码怎么进密码库

密码库是零知识的：**服务端没有主密钥，无法替 Agent 加密条目**。所以 Agent 不能直接写 `/api/ciphers`。
tirisfal 用「提议 → 人类确认」解决：

```bash
# 1) Agent 提交（需要该项目的 write 授权）
curl -X POST $API/api/agent-proposals \
  -H "Authorization: Bearer <machine-token>" -H "Content-Type: application/json" \
  -d '{"project_id":"<id>","name":"GENERATED_DB_PASS","value":"<AI 生成的值>"}'

# 2) 人类：Web → Secrets Manager → 「待确认」 → 存入密码库
#    浏览器端用主密钥加密后调用 /api/ciphers，随后自动删除提议
```

- 提议值用服务端 `ENCRYPTION_KEY`（v3）加密暂存，默认 30 天过期
- 读取单条提议明文只允许**属主用户**；机器账号不能读取
- 确认时加密发生在浏览器，零知识不被破坏

---

## 配置

| 变量 | 要求 | 说明 |
|---|---|---|
| `JWT_SECRET` | **必填** | 访问令牌签名（≥32 字符） |
| `ENCRYPTION_KEY` | **必填** | 凭证 / TOTP 密钥 / 备份设置的默认加密密钥；使用后不可更换 |
| `TOTP_SECRET` | 可选 | TOTP 密钥独立加密密钥；未设时回退 `ENCRYPTION_KEY`。轮换它会让已加密的 TOTP 密钥无法解密 |
| `BACKUP_ENCRYPTION_KEY` | 可选 | 备份运行时密钥；未设时回退 `JWT_SECRET` |
| `CLIENT_IP_HEADER` | 可选 | 客户端 IP 头名；默认 `CF-Connecting-IP` |
| `PROXY_SHARED_SECRET` | 可选 | 反代共享密钥；设置后直连 worker 无法伪造客户端 IP |
| `OUTBOUND_DNS_GUARD` | 可选 | `1` 开启注入目标逐次 DNS 解析校验；默认关闭 |

---

## 文档

| 文档 | 内容 |
|---|---|
| [docs/DOCKER.md](docs/DOCKER.md) | 自托管部署：镜像、Caddy/Tunnel、备份、升级回滚、排障 |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | 云端运维：密钥、迁移、备份恢复、Agent 接入 SOP、回滚 |
| [docs/API.md](docs/API.md) | REST API 参考 |
| [docs/CODE-REVIEW-2026-11-08.md](docs/CODE-REVIEW-2026-11-08.md) | 多维度代码审查与修复记录 |

---

## 路线图（近期）

1. 凭证生命周期：版本、轮换、过期 + per-project DEK（降低单把 `ENCRYPTION_KEY` 的风险）
2. 登录/仓储链路收敛 + 写路径 `db.batch` 原子化
3. 可观测性：注入延迟 / 拒绝原因指标 + 结构化日志
4. 前端分包与无障碍
5. MCP 端点（试点，复用 `/use`）

**明确不做**：多租户/HA 集群、把 SM 改成端到端加密、前端重写。

---

## 许可证

LGPL-3.0-or-later。自用、内部部署、或以 SaaS 方式对外提供服务不触发开源义务；分发修改版需同样开源。

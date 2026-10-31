# 运维手册（Operations Runbook）

> 适用版本：**v1.6.0**（含 Secrets Manager 注入代理与默认掩码）
> 目标：把"能跑"变成"能长期稳定跑"。所有操作都假设你手上已有 Cloudflare 账号权限与 wrangler。

## 1. 部署

```bash
npm ci
npm run build            # 产出 dist/（前端静态资源）
npm run deploy           # wrangler deploy，读取 wrangler.toml
```

- 绑定：D1 `DB`、R2 `ATTACHMENTS`、Durable Object `NOTIFICATIONS_HUB`、cron `*/5 * * * *`。
- 部署后自检：

```bash
curl -s https://<your-domain>/api/health   # 期望 {"status":"healthy","services":{"database":"ok","storage":"ok"}}
```

> 本地开发/验证建议用**独立 worker + 独立 D1**（`wrangler.<env>.toml`），测完删除，避免污染生产数据。

## 2. 密钥（最容易被忽略、后果最重）

| 变量 | 作用 | 能否更换 |
|---|---|---|
| `JWT_SECRET` | 签发/校验访问令牌（≥32 字符） | 可更换，但会让所有已登录会话失效 |
| `ENCRYPTION_KEY` | 加密 Secrets Manager 的 `value` | **不可直接更换**：更换后历史密文永久无法解密 |

设置方式：`wrangler secret put JWT_SECRET` / `wrangler secret put ENCRYPTION_KEY`（或对应 API）。
**不要把这两个值写进仓库、README、CI 变量或聊天记录。**

如果确实需要轮换 `ENCRYPTION_KEY`：先写一个读旧密钥、写新密钥的迁移脚本（逐条 re-encrypt），在维护窗口执行，验证后再切换。

## 3. 数据库迁移

`migrations/*.sql` 按序号执行，当前到 **0007**：

| 迁移 | 内容 |
|---|---|
| 0001-0005 | 基础表、SM 表、TOTP 防重放、refresh token family、索引 |
| 0006 | 注入代理：`machine_account_projects.mode/allowed_hosts`、审计 `host/purpose` |
| 0007 | 掩码与 reveal：`reveal_limit / reveal_count` |

执行方式（二选一）：

```bash
wrangler d1 execute <db> --remote --file=./migrations/0007_reveal_policy.sql
# 或用 Cloudflare API: POST /accounts/<acc>/d1/database/<db>/query
```

⚠️ SQLite 的 `ALTER TABLE ADD COLUMN` 不支持回滚；新增列是安全的（旧代码忽略新列），但**删列/改列需要重建表**——生产上不要直接跑破坏性 DDL。

## 4. 备份与恢复

- **D1**：控制台 → D1 → 数据库 → Export，或 API `POST /accounts/<acc>/d1/database/<db>/export`。
- **R2**：`rclone`/`aws s3` 同步 `<bucket>`；附件是加密后的密文，脱库不等于泄露明文。
- **建议节奏**：每日 D1 导出 + 每周 R2 全量，保留 ≥14 天。
- 恢复演练：把导出导入一个**临时 D1**，用 staging worker 验证登录/同步/凭证读取，再决定是否覆盖生产。

## 5. Agent 接入 SOP

```
① 建 machine account        POST /api/machine-accounts
② 签发 access token         POST /api/machine-accounts/:id/token       （仅返回一次，落库只存 hash）
③ 建项目 + 写凭证            POST /api/projects / POST /api/secrets
④ 授权项目                  POST /api/machine-accounts/:id/projects/:projectId
                            { "permission":"read", "mode":"inject",
                              "allowed_hosts":["api.example.com"], "reveal_limit":1 }
⑤ Agent 调用                POST /api/secrets/use    （推荐，明文不出服务端）
   或受控读取                GET  /api/secrets/by-name/:name?project_id=..&reveal=1
```

授权参数速查：

| 参数 | 说明 |
|---|---|
| `mode` | `inject`（默认，读接口只给掩码）/ `reveal`（允许显式读取） |
| `allowed_hosts` | inject 模式必填；支持 `*.example.com` 单层通配 |
| `allowed_ip` / `allowed_hours` | 额外访问约束（缺 IP 时按 fail-closed 拒绝） |
| `max_requests_per_minute` | 按 grant 限流 |
| `reveal_limit` | reveal 可用次数（默认 1，`null` 为不限） |

## 6. 排障速查

| 现象 | 排查 |
|---|---|
| `/api/health` 里 database 不是 ok | D1 绑定 id 是否与 `wrangler.toml` 一致；迁移是否执行 |
| Machine token 401 | 先确认 worker 版本包含 1.6.0 的路由修复（SM 路由早于 JWT 校验） |
| `/use` 返回 403 | 看 grant 的 `mode`、`allowed_hosts`、IP/时段/过期；错误信息已区分原因 |
| `reveal=1` 返回 429 | `reveal_limit` 配额用尽；重新授权或调大上限 |
| 登录锁定 | 5 次失败 / 15 分钟；错误文案已统一，不再暴露剩余时间 |

## 7. 回滚

- **代码**：`wrangler deployments list` 找到上一个版本 → `wrangler rollback [version-id]`。
- **数据**：只有新列是向后兼容的；如果新版本写入了旧代码不认识的语义，回滚前先评估该列是否被旧代码读取。
- **迁移**：不可逆，回滚代码不会回滚表结构（新增列保留即可）。

## 8. 已知边界（投入使用时请写进验收标准）

1. **DNS rebinding**：Workers 不能自定义 DNS 解析，只能靠 `allowed_hosts` 白名单兜底；白名单必须由运维人工确认主机归属。
2. **仅 HTTP(S)**：SSH、数据库、SMTP 等非 HTTP 凭证不能用 `/use` 代理，需要本地 sidecar。
3. **响应截断**：`/use` 最多返回 512KB，超出会截断并标记 `X-Tirisfal-Truncated: 1`。
4. **明细审计不含密文**：审计记录 host/purpose/status，不记录请求体与凭证值。
5. **单密钥加密**：`ENCRYPTION_KEY` 为全局密钥，尚无 per-secret DEK；轮换需要离线重加密。

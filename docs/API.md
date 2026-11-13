# API Documentation

## Authentication

All authenticated endpoints require a Bearer token in the Authorization header.

### Machine Account Token

```
Authorization: Bearer <machine-account-token>
```

## Endpoints

### Health Check

```
GET /health
GET /api/health?detailed=true
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2026-06-12T00:00:00.000Z",
  "version": "2026.1.0",
  "services": {
    "database": "ok",
    "storage": "ok"
  }
}
```

### Machine Accounts

#### Create Machine Account

```
POST /api/machine-accounts
Content-Type: application/json

{
  "name": "agent-name",
  "description": "Agent description"
}
```

Response:
```json
{
  "id": "uuid",
  "name": "agent-name",
  "user_id": "user-uuid",
  "status": "active",
  "created_at": "2026-06-12T00:00:00.000Z"
}
```

#### Generate Access Token

```
POST /api/machine-accounts/:id/token
Content-Type: application/json

{
  "expiry_days": 30
}
```

Response:
```json
{
  "access_token": "...",
  "expires_at": "2026-07-12T00:00:00.000Z"
}
```

#### Revoke Access Token

```
POST /api/machine-accounts/:id/revoke-token
```

Response:
```json
{
  "success": true,
  "message": "Token revoked"
}
```

### Projects

#### Create Project

```
POST /api/projects
Content-Type: application/json

{
  "name": "project-name",
  "description": "Project description"
}
```

#### Grant Access

```
POST /api/machine-accounts/:id/projects/:project-id
Content-Type: application/json

{
  "permission": "read",
  "allowed_ip": ["192.168.1.0/24"],
  "allowed_hours": {"start": 9, "end": 18},
  "max_requests_per_minute": 60,
  "expires_at": "2026-12-31T23:59:59.000Z"
}
```

### Secrets

#### Create Secret

```
POST /api/secrets
Content-Type: application/json

{
  "name": "API_KEY",
  "value": "sk-***",
  "project_id": "...",
  "environment": "prod"
}
```

#### Get Secret (Decrypted)

```
GET /api/secrets/by-name/:name?project_id=...&environment=prod
```

Response:
```json
{
  "id": "...",
  "name": "API_KEY",
  "value": "decrypted-value",
  "project_id": "...",
  "environment": "prod"
}
```

### Agent Proposals

Agent 生成或获取的密码先暂存为「待确认提议」，人类在 Web「待确认」页确认后，由浏览器用主密钥加密写入密码库（服务端不持有主密钥）。

#### Submit a Proposal（Machine Account）

`POST /api/agent-proposals` — 需要目标项目的 `write` 授权。

| 字段 | 类型 | 说明 |
|---|---|---|
| `project_id` | string(UUID) | 必填 |
| `name` | string | 必填，≤255 |
| `value` | string | 必填，≤10000 |
| `environment` | string | 可选，`prod` / `staging` / `dev` / `test`，默认 `prod` |
| `note` | string | 可选，≤1000；**明文存储**，仅属主可见 |

`201`：`{ "success": true, "id": "...", "expires_at": "...", "environment": "prod" }`
`400`：字段缺失/超长/枚举非法；`403`：无 write 授权或未授权。

#### List Proposals（User Token）

`GET /api/agent-proposals` → `{ "data": [{ id, project_id, project_name, name, environment, note, created_at, expires_at }] }`
不含明文 value。**机器账号调用返回 403**（只能提交，不能列举）。

#### Read a Proposal（User Token）

`GET /api/agent-proposals/:id` → `{ id, name, value, note, project_id }`（明文，仅属主；机器账号 403）。

#### Delete a Proposal

`DELETE /api/agent-proposals/:id` → `{ "success": true }`
人类拒绝，或创建它的机器账号撤回。

提议默认保留 30 天（`config/limits.ts` 的 `agentProposal.ttlMs`），过期惰性清理。

### YubiKey OTP

需要服务端配置 `YUBICO_CLIENT_ID` / `YUBICO_SECRET`（可选 `YUBICO_VALIDATION_URL`）。

| 端点 | 说明 |
|---|---|
| `GET /two-factor/yubikey` | 列出已绑定钥匙（publicId 仅回显前 4 位） |
| `POST /two-factor/yubikey` | 绑定：`{ masterPasswordHash, otp, name? }`；OTP 需 44 位 modhex |
| `DELETE /two-factor/yubikey/:id` | 解绑：`{ masterPasswordHash }` |

登录第二步仍走 `POST /identity/connect/token`，`twoFactorProvider=3`、`twoFactorToken=<按一下钥匙产生的 OTP>`。

## Error Responses

```json
{
  "error": "Error message",
  "error_description": "Detailed error description",
  "ErrorModel": {
    "Message": "Error message",
    "Object": "error"
  }
}
```

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Public API | 60 requests/minute |
| Authenticated API | 200 requests/minute |
| Login | 10 attempts/2 minutes |
| Register | 5 requests/minute |
| Secret Manager 路由（`/api/secrets*`、`/api/agent-proposals`） | 30 requests/minute/IP |
| Token 端点（`/identity/connect/token`） | 30 requests/minute/IP |

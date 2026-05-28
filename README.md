# Tirisfal Secrets Manager

**为 AI Agent 设计的凭证管理服务，运行在 Cloudflare Workers 上。**

---

## 核心功能

| 功能 | 说明 |
|------|------|
| **Machine Accounts** | 为每个 Agent 创建独立的机器账号 |
| **Projects** | 按项目分组管理凭证 |
| **Secrets** | 安全存储 API Key、Token、密码等凭证 |
| **Access Tokens** | Agent 通过 Token 访问凭证 |
| **Audit Logs** | 记录所有凭证访问行为 |

---

## Agent 接入方式

### 1. 创建 Machine Account

```bash
# 通过 API 创建机器账号
curl -X POST https://your-worker.workers.dev/api/machine-accounts \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "ningzhi", "description": "宁织 Agent"}'
```

### 2. 获取 Access Token

```bash
# 为 Machine Account 生成访问令牌
curl -X POST https://your-worker.workers.dev/api/machine-accounts/<id>/token \
  -H "Authorization: Bearer <user-token>"
```

### 3. 创建项目和凭证

```bash
# 创建项目
curl -X POST https://your-worker.workers.dev/api/projects \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "SN-Team", "description": "SN团队凭证"}'

# 创建凭证
curl -X POST https://your-worker.workers.dev/api/secrets \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "XIAOMI_API_KEY", "value": "sk-***", "project_id": "<project-id>"}'
```

### 4. Agent 获取凭证

```bash
# 通过 Access Token 获取凭证
curl https://your-worker.workers.dev/api/secrets/by-name/XIAOMI_API_KEY \
  -H "Authorization: Bearer <machine-account-token>" \
  -d '{"project_id": "<project-id>", "environment": "prod"}'
```

---

## API 端点

### Machine Accounts

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/machine-accounts` | 创建机器账号 |
| GET | `/api/machine-accounts` | 列出所有机器账号 |
| GET | `/api/machine-accounts/:id` | 获取机器账号详情 |
| PUT | `/api/machine-accounts/:id` | 更新机器账号 |
| DELETE | `/api/machine-accounts/:id` | 删除机器账号 |
| POST | `/api/machine-accounts/:id/token` | 生成访问令牌 |

### Projects

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects` | 创建项目 |
| GET | `/api/projects` | 列出所有项目 |
| GET | `/api/projects/:id` | 获取项目详情 |
| PUT | `/api/projects/:id` | 更新项目 |
| DELETE | `/api/projects/:id` | 删除项目 |

### Secrets

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/secrets` | 创建凭证 |
| GET | `/api/secrets?project_id=<id>` | 列出项目下的凭证 |
| GET | `/api/secrets/:id` | 获取凭证详情 |
| PUT | `/api/secrets/:id` | 更新凭证 |
| DELETE | `/api/secrets/:id` | 删除凭证 |
| GET | `/api/secrets/by-name/:name` | 通过名称获取凭证 |

---

## Agent 集成示例

### OpenClaw Agent

在 Agent 的 TOOLS.md 中添加：

```markdown
## 凭证管理

### 获取凭证
```bash
VALUE=$(curl -s https://your-worker.workers.dev/api/secrets/by-name/<SECRET_NAME> \
  -H "Authorization: Bearer $NW_TOKEN" | jq -r .value)
```

### 环境变量
- NW_TOKEN: Access Token
- NW_SERVER: 服务地址
```

### Hermes Agent

在 Agent 的 TOOLS.md 中添加：

```markdown
## 凭证管理

### 获取凭证
```bash
curl -s https://your-worker.workers.dev/api/secrets/by-name/<SECRET_NAME> \
  -H "Authorization: Bearer $NW_TOKEN" | jq -r .value
```
```

---

## 权限控制

| 角色 | 权限 |
|------|------|
| **User** | 创建/管理 Machine Account、Project、Secret |
| **Machine Account** | 只能读取被授权的 Project 下的 Secret |

### 授权示例

```bash
# 授予 Machine Account 对项目的读取权限
curl -X POST https://your-worker.workers.dev/api/machine-accounts/<id>/projects/<project-id> \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"permission": "read"}'
```

---

## 安全特性

- **端到端加密** — 凭证加密存储
- **最小权限** — Agent 只能访问被授权的凭证
- **审计日志** — 所有访问行为可追溯
- **Token 轮换** — 支持定期更换访问令牌
- **过期机制** — Token 可设置过期时间

---

## 部署

```bash
# 克隆仓库
git clone https://github.com/ialer/tirisfal.git
cd tirisfal

# 安装依赖
npm install

# 配置环境变量
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 设置 JWT_SECRET

# 本地开发
npm run dev

# 部署到 Cloudflare Workers
npm run deploy
```

---

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `JWT_SECRET` | ✅ | JWT 签名密钥（32+ 字符） |
| `DB` | ✅ | D1 数据库绑定 |
| `ATTACHMENTS` | ❌ | R2 存储桶（可选） |

---

## 文档

- [部署指南](#部署)
- [API 文档](#api-端点)
- [Agent 集成](#agent-集成示例)
- [安全特性](#安全特性)

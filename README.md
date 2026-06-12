<p align="center">
  <img src="https://img.shields.io/badge/version-1.5.1-blue" alt="version">
  <img src="https://img.shields.io/badge/license-LGPL--3.0-green" alt="license">
  <img src="https://img.shields.io/badge/cloudflare-workers-orange" alt="cloudflare">
  <img src="https://img.shields.io/badge/encryption-AES--256--GCM-red" alt="encryption">
</p>

<h1 align="center">🔐 Tirisfal</h1>

<p align="center">
  <strong>为 AI Agent 设计的自托管凭证管理服务</strong>
</p>

<p align="center">
  运行在 Cloudflare Workers 上，支持 Bitwarden 兼容协议
</p>

---

## ✨ 特性

<div align="center">

| 功能 | 描述 |
|:---:|:---|
| 🤖 | **Machine Accounts** - 为每个 Agent 创建独立的机器账号 |
| 📁 | **Projects** - 按项目分组管理凭证 |
| 🔑 | **Secrets** - 安全存储 API Key、Token、密码等凭证 |
| 🎫 | **Access Tokens** - Agent 通过 Token 访问凭证 |
| 📊 | **Audit Logs** - 记录所有凭证访问行为 |
| 🔒 | **End-to-End Encryption** - AES-256-GCM 加密存储 |

</div>

---

## 🚀 快速开始

### 部署

```bash
# 克隆仓库
git clone https://github.com/ialer/tirisfal.git
cd tirisfal

# 安装依赖
npm install

# 配置环境变量
cp .dev.vars.example .dev.vars

# 设置密钥
wrangler secret put JWT_SECRET
wrangler secret put ENCRYPTION_KEY

# 初始化数据库
wrangler d1 execute tirisfal-db --file=./migrations/0001_init.sql
wrangler d1 execute tirisfal-db --file=./migrations/0002_sm_tables.sql

# 部署
npm run deploy
```

### 本地开发

```bash
npm run dev
```

---

## 📖 使用指南

### 1️⃣ 创建 Machine Account

```bash
curl -X POST https://your-worker.workers.dev/api/machine-accounts \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent", "description": "My AI Agent"}'
```

### 2️⃣ 获取 Access Token

```bash
curl -X POST https://your-worker.workers.dev/api/machine-accounts/<id>/token \
  -H "Authorization: Bearer <user-token>"
```

### 3️⃣ 创建项目和凭证

```bash
# 创建项目
curl -X POST https://your-worker.workers.dev/api/projects \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project"}'

# 创建凭证
curl -X POST https://your-worker.workers.dev/api/secrets \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "API_KEY", "value": "sk-***", "project_id": "<project-id>"}'
```

### 4️⃣ Agent 获取凭证

```bash
curl "https://your-worker.workers.dev/api/secrets/by-name/API_KEY?project_id=<id>&environment=prod" \
  -H "Authorization: Bearer <machine-token>" | jq -r .value
```

---

## 🔐 安全特性

<div align="center">

| 特性 | 实现 |
|:---:|:---|
| 🔑 | **AES-256-GCM** - 行业标准加密算法 |
| 🧂 | **PBKDF2 600K** - OWASP 推荐迭代次数 |
| ⏰ | **Token Rotation** - 支持自动轮换和撤销 |
| 🛡️ | **IP Whitelist** - 限制访问来源 |
| 🕐 | **Time Window** - 基于时间的访问控制 |
| 📝 | **Audit Trail** - 完整的访问日志 |

</div>

---

## 🛠️ API 参考

### Machine Accounts

| 方法 | 端点 | 描述 |
|:---:|:---|:---|
| `POST` | `/api/machine-accounts` | 创建机器账号 |
| `GET` | `/api/machine-accounts` | 列出所有机器账号 |
| `GET` | `/api/machine-accounts/:id` | 获取机器账号详情 |
| `PUT` | `/api/machine-accounts/:id` | 更新机器账号 |
| `DELETE` | `/api/machine-accounts/:id` | 删除机器账号 |
| `POST` | `/api/machine-accounts/:id/token` | 生成访问令牌 |
| `POST` | `/api/machine-accounts/:id/revoke-token` | 撤销访问令牌 |

### Projects

| 方法 | 端点 | 描述 |
|:---:|:---|:---|
| `POST` | `/api/projects` | 创建项目 |
| `GET` | `/api/projects` | 列出所有项目 |
| `GET` | `/api/projects/:id` | 获取项目详情 |
| `DELETE` | `/api/projects/:id` | 删除项目 |

### Secrets

| 方法 | 端点 | 描述 |
|:---:|:---|:---|
| `POST` | `/api/secrets` | 创建凭证 |
| `GET` | `/api/secrets?project_id=<id>` | 列出项目下的凭证 |
| `GET` | `/api/secrets/:id` | 获取凭证详情 |
| `PUT` | `/api/secrets/:id` | 更新凭证 |
| `DELETE` | `/api/secrets/:id` | 删除凭证 |
| `GET` | `/api/secrets/by-name/:name` | 通过名称获取凭证 |

---

## 📦 SDK

我们提供多语言 SDK，简化 Agent 集成：

### Python

```python
from tirisfal import TirisfalClient

client = TirisfalClient(
    server="https://your-worker.workers.dev",
    token="your-machine-account-token"
)

secret = client.get_secret("API_KEY", project_id="xxx", environment="prod")
print(secret.value)
```

### Node.js

```javascript
const { TirisfalClient } = require('@tirisfal/sdk');

const client = new TirisfalClient({
  server: 'https://your-worker.workers.dev',
  token: 'your-machine-account-token'
});

const secret = await client.getSecret('API_KEY', { projectId: 'xxx' });
console.log(secret.value);
```

### Go

```go
import "github.com/ialer/tirisfal/sdk/go"

client := tirisfal.NewClient("https://your-worker.workers.dev", "your-token")
secret, _ := client.GetSecret("API_KEY", "project-id", "prod")
fmt.Println(secret.Value)
```

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Cloudflare Workers                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │    Auth      │  │    SM API   │  │   Backup    │        │
│  │   Service    │  │   Service   │  │   Service   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                  │
│  ┌──────┴────────────────┴────────────────┴──────┐        │
│  │              SecretsManagerService             │        │
│  └──────────────────────┬────────────────────────┘        │
│                         │                                  │
│  ┌──────────────────────┴────────────────────────┐        │
│  │           AES-256-GCM Encryption              │        │
│  └──────────────────────┬────────────────────────┘        │
│                         │                                  │
├─────────────────────────┼──────────────────────────────────┤
│  ┌──────────────────────┴────────────────────────┐        │
│  │                    D1 Database                 │        │
│  │  ┌─────────────┐  ┌─────────────┐            │        │
│  │  │   secrets   │  │   projects  │            │        │
│  │  └─────────────┘  └─────────────┘            │        │
│  └───────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 配置

### 环境变量

| 变量 | 必填 | 描述 |
|:---:|:---:|:---|
| `JWT_SECRET` | ✅ | JWT 签名密钥（32+ 字符） |
| `ENCRYPTION_KEY` | ✅ | 加密密钥（32+ 字符） |
| `DB` | ✅ | D1 数据库绑定 |
| `ATTACHMENTS` | ❌ | R2 存储桶（可选） |

### 生成密钥

```bash
# 生成 JWT 密钥
openssl rand -hex 32

# 生成加密密钥
openssl rand -base64 32
```

---

## 📚 文档

- [API 文档](docs/API.md)
- [优化报告](docs/OPTIMIZATION.md)

---

## 🤝 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详情。

---

## 📄 许可证

本项目使用 [LGPL-3.0](LICENSE) 许可证。

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/ialer">SN Team</a></sub>
</p>

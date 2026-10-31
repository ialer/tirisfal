<p align="center">
  <img src="https://img.shields.io/badge/version-1.6.0-blue" alt="version">
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

### 4️⃣ Agent 接入（推荐：不落明文）

**a. 授权**：把机器账号授权到项目，选择模式与目标主机白名单

```bash
curl -X POST https://your-worker.workers.dev/api/machine-accounts/<account-id>/projects/<project-id> \
  -H "Authorization: Bearer <user-token>" -H "Content-Type: application/json" \
  -d '{"permission":"read","mode":"inject","allowed_hosts":["api.openai.com"]}'
```

- `mode: inject`（默认）：**读接口只返回掩码**，凭证只能经注入代理使用；
- `mode: reveal`：允许显式读取明文，建议同时设置 `reveal_limit`（默认 1 次）；
- `allowed_hosts`：注入目标白名单，inject 模式必填。

**b. 注入调用**：Agent 只拿引用，真值不出服务端

```bash
curl -X POST https://your-worker.workers.dev/api/secrets/use \
  -H "Authorization: Bearer <machine-token>" -H "Content-Type: application/json" \
  -d '{
        "project_id": "<project-id>",
        "name": "API_KEY",
        "url": "https://api.openai.com/v1/chat/completions",
        "method": "POST",
        "purpose": "chat completion",
        "body": "{\"model\":\"gpt-5\",\"messages\":[]}"
      }'
```

服务端取出真值并注入 `Authorization` 头，只回上游响应；若上游把凭证回显，响应里的明文会被替换为 `***REDACTED***`。

**c. 受控读取**（仅 `mode=reveal` 的授权）

```bash
curl "https://your-worker.workers.dev/api/secrets/by-name/API_KEY?project_id=<id>&reveal=1" \
  -H "Authorization: Bearer <machine-token>"
```

不带 `reveal=1` 一律返回掩码（`sk-a****9f2c`）；每次显式 reveal 会原子消耗一次配额，超限返回 429。
人类用户（浏览器 / 官方客户端）不受影响，始终读取明文。

---

## 🔐 安全特性

<div align="center">

| 特性 | 实现 |
|:---:|:---|
| 🔑 | **AES-256-GCM** - 行业标准加密算法 |
| 🧂 | **PBKDF2 600K** - 客户端主密码派生（迭代数可配置）；服务端敏感值加密另用 HKDF/AES-GCM |
| ⏰ | **Token Rotation** - 支持自动轮换和撤销 |
| 🛡️ | **IP Whitelist** - 限制访问来源 |
| 🕐 | **Time Window** - 基于时间的访问控制 |
| 📝 | **Audit Trail** - 完整的访问日志 |
| 🚦 | **D1 Atomic Rate Limiting** - 防竞态条件速率限制 |
| 🔒 | **Constant-Time Comparison** - 防时序攻击 |
| 🛡️ | **Project Ownership Verification** - 防跨用户访问 |
| 🙈 | **Default Masking** - Machine Account 读取默认返回掩码 |
| 💉 | **Credential Injection** - 凭证由服务端注入，明文不进 Agent 上下文 |
| 🚧 | **SSRF Guard** - 目标主机白名单 + 拒绝 IP 字面量/私网 |

</div>

### 安全审计

本项目经过全面安全审计，已修复以下问题：

#### 严重漏洞 (已修复)

- ✅ **速率限制绕过** - 移除不安全的导入绕过逻辑
- ✅ **Cache API 竞态条件** - 改用 D1 原子操作防止并发绕过
- ✅ **项目所有权验证缺失** - 添加跨用户访问防护

#### 高危漏洞 (已修复)

- ✅ **常量时间比较时序泄漏** - 修复 API Key 比较实现
- ✅ **SM 端点缺少速率限制** - 为 Machine Account Token 添加限流
- ✅ **凭证访问审计盲区** - 补全 GET /api/secrets/:id 审计日志

#### 隐性问题 (已修复)

- ✅ **内存溢出风险** - 同步响应添加 50MB 大小限制
- ✅ **缓存无界增长** - AuthService 添加 LRU 淘汰策略
- ✅ **登录锁定过于宽松** - 优化为 5次/15分钟策略

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
| `POST` | `/api/machine-accounts/:id/projects/:projectId` | 授权项目（mode / allowed_hosts / reveal_limit） |
| `DELETE` | `/api/machine-accounts/:id/projects/:projectId` | 撤销项目授权 |
| `GET` | `/api/machine-accounts/:id/projects` | 列出已授权项目 |

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
| `POST` | `/api/secrets/use` | 注入代理：用凭证替调用方访问白名单上游（Machine Account） |

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

### 数据库表

项目使用以下 D1 数据表：

| 表名 | 用途 |
|:---|:---|
| `users` | 用户账户 |
| `ciphers` | 密码项 |
| `folders` | 文件夹 |
| `attachments` | 附件 |
| `sends` | Send 分享 |
| `refresh_tokens` | 刷新令牌 |
| `devices` | 设备绑定 |
| `audit_logs` | 审计日志 |
| `login_attempts_ip` | 登录失败记录 |
| `rate_limits` | API 速率限制 |
| `machine_accounts` | 机器账号 |
| `sm_projects` | 项目 |
| `secrets` | 凭证 |
| `machine_account_projects` | 机器账号项目权限 |
| `secret_access_logs` | 凭证访问日志 |

---

## 📚 文档

- [API 文档](docs/API.md)
- [优化报告](docs/OPTIMIZATION.md)

---

## 🤝 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详情。

---

## 📄 许可证

本项目核心代码采用 **LGPL-3.0-or-later**（SPDX：`LGPL-3.0-or-later`），全文见 [LICENSE](LICENSE)。

LGPLv3 以 GPLv3 条款为基础，因此仓库同时附带 [LICENSE.GPL-3.0](LICENSE.GPL-3.0)。

- 自用、内部部署、以 SaaS（如 Cloudflare Workers）方式对外提供服务：不触发开源义务；
- 分发二进制 / 镜像 / 安装包：需随附源码与许可证文本；若修改了本项目，修改部分需以 LGPL-3.0 开源；
- `sdk/` 目录下的客户端 SDK 单独采用 MIT 许可证（见各 `sdk/*/package.json`），便于第三方集成。

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/ialer">SN Team</a></sub>
</p>

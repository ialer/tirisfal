<div align="center">

# 🚀 Tirisfal

**自托管密码管理器 · Bitwarden 协议兼容 · Cloudflare Workers 部署**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com)
[![Bitwarden Compatible](https://img.shields.io/badge/Bitwarden-Compatible-green.svg)](https://bitwarden.com)

*安全 · 极速 · 零服务器 · 全球边缘网络*

[在线体验](https://tirisfal.pages.dev) · [部署指南](#-部署指南) · [功能特性](#-功能特性) · [Bitwarden 扩展对接](#-bitwarden-浏览器扩展对接)

</div>

---

## ✨ 为什么选择 Tirisfal？

### 对比传统自托管方案

| 特性 | Tirisfal | Vaultwarden | Bitwarden 官方 |
|---|---|---|---|
| **部署方式** | Cloudflare Workers (Serverless) | VPS / Docker | VPS / Docker |
| **服务器成本** | **免费** (10万次/天) | 需要 VPS ($5+/月) | 需要 VPS ($20+/月) |
| **全球访问** | ✅ 边缘节点自动就近 | ❌ 单点服务器 | ⚠️ 需要自己配置 CDN |
| **自动扩缩** | ✅ 无需运维 | ❌ 需要监控 | ❌ 需要监控 |
| **DDoS 防护** | ✅ Cloudflare 内置 | ❌ 需要额外配置 | ❌ 需要额外配置 |
| **HTTPS** | ✅ 自动 | ⚠️ 需要配置 | ⚠️ 需要配置 |
| **数据库** | D1 (SQLite 边缘) / KV | SQLite / MySQL | MySQL / PostgreSQL |
| **内存占用** | 0 (Serverless) | ~50MB+ | ~500MB+ |

### 核心优势

- **💰 零成本运行** — Cloudflare Workers 免费额度：10万次请求/天，10GB 存储，完全够个人/小团队使用
- **🌍 全球极速** — 代码部署在 Cloudflare 全球 300+ 边缘节点，任何地方访问都是毫秒级响应
- **🔐 端到端加密** — 和 Bitwarden 一样的加密方案 (AES-256-CBC + RSA-2048)，密钥从不离开客户端
- **⚡ 零运维** — 不需要服务器、不需要 Docker、不需要 SSL 证书、不需要监控，部署后完全托管
- **🛡️ 内置安全** — Cloudflare 全球 DDoS 防护 + WAF + Rate Limiting，开箱即用

---

## 🎯 功能特性

### 🔐 认证与安全
- 注册 / 登录 / 2FA (TOTP)
- WebAuthn / Passkey 支持
- 恢复代码 (Recovery Code)
- 设备授权管理 (30天受信会话)
- API Key 管理 + 轮换
- 密码提示 (Password Hint)
- 速率限制 (防止暴力破解)

### 📦 密码库
- 完整 CRUD (创建/读取/更新/删除)
- 文件夹管理 (组织密码)
- 附件上传/下载 (加密存储)
- 归档/恢复 (软删除)
- 批量操作 (移动/删除/归档)
- 收藏夹 (高频密码置顶)
- 自定义字段 (文本/密码/邮箱/电话/地址)
- 信用卡管理 (卡号/CVV/有效期/品牌)
- 加密安全笔记
- SSH 密钥管理
- Passkey/FIDO2 凭据存储
- TOTP 验证码页面 (拖拽排序 + 倒计时环)

### 🔗 安全分享
- Send 功能 (创建安全分享链接)
- 文件分享 (加密上传)
- 密码保护 (访问时需要密码)
- 时效控制 (自动过期)

### 📥 导入/导出 (46+ 格式)
- **密码管理器**: Bitwarden / 1Password / LastPass / Dashlane / KeePass / Keeper / ProtonPass / NordPass / Enpass / RoboForm / Zoho Vault / mSecure / Myki / LogMeOnce / Password Boss / Passman / Passky / Psono
- **浏览器**: Chrome / Edge / Brave / Opera / Vivaldi / Firefox / Safari
- **其他**: Avast / Avira / Blur / Buttercup / Codebook / Encryptr / Keeper / Meldium / Netwrix / Ascendo DataVault / BlackBerry Password Keeper / Arc
- **导出格式**: Bitwarden JSON / 加密 JSON / CSV / ZIP (含附件) / Tirisfal JSON

### 💾 备份与恢复
- 本地备份/恢复
- 远程备份 (WebDAV / S3 兼容存储)
- 备份中心 UI (可视化管理)
- 附件增量备份
- 备份设置加密存储

### ⚙️ 管理功能
- 用户管理 (Admin Panel)
- 域名规则 (自动匹配 URL)
- 品牌定制 (Logo / 标题 / 主题色)
- 多语言支持 (中文/繁中/英文/俄文/西班牙文)
- 暗色/亮色主题
- 网站图标缓存 (自动抓取 Favicon)
- 密码生成器
- 响应式设计 (移动端完美适配)

---

## 🌐 Bitwarden 浏览器扩展对接

Tirisfal 完全兼容 Bitwarden API 协议，可以直接使用 Bitwarden 官方浏览器扩展：

### 安装步骤

1. 安装 [Bitwarden 浏览器扩展](https://bitwarden.com/download/) (Chrome / Firefox / Edge / Safari)
2. 打开扩展设置 → **自托管服务器**
3. 填写：
   - **服务器域名**: `你的域名` (例如 `mm.snbar.top`)
4. 登录你的 Tirisfal 账号

### 支持的客户端

| 平台 | 客户端 | 状态 |
|---|---|---|
| **Chrome** | Bitwarden 扩展 | ✅ 完全兼容 |
| **Firefox** | Bitwarden 扩展 | ✅ 完全兼容 |
| **Edge** | Bitwarden 扩展 | ✅ 完全兼容 |
| **Safari** | Bitwarden 扩展 | ✅ 完全兼容 |
| **iOS** | Bitwarden App | ✅ 完全兼容 |
| **Android** | Bitwarden App | ✅ 完全兼容 |
| **Windows** | Bitwarden Desktop | ✅ 完全兼容 |
| **macOS** | Bitwarden Desktop | ✅ 完全兼容 |
| **Linux** | Bitwarden Desktop | ✅ 完全兼容 |
| **CLI** | Bitwarden CLI | ✅ 完全兼容 |

> 💡 **推荐**: 安装浏览器扩展后，自动填充、密码生成、TOTP 验证码等功能都可以直接使用，无需等待 Tirisfal 官方客户端。

---

## 🚀 部署指南

### 前提条件

- [Node.js](https://nodejs.org/) >= 18
- [Cloudflare 账号](https://dash.cloudflare.com/) (免费即可)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 一键部署

```bash
# 1. 克隆项目
git clone https://github.com/ialer/tirisfal.git
cd tirisfal

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，设置 JWT_SECRET (随机生成的长字符串)

# 4. 创建 D1 数据库
npx wrangler d1 create tirisfal-db
# 记下输出的 database_id，填入 wrangler.toml

# 5. 初始化数据库
npx wrangler d1 execute tirisfal-db --file=./migrations/001_init.sql

# 6. 部署到 Cloudflare Workers
npm run deploy
```

### 环境变量配置

在 Cloudflare Dashboard → Workers → 你的项目 → Settings → Environment Variables 中设置：

| 变量名 | 说明 | 必填 |
|---|---|---|
| `JWT_SECRET` | JWT 签名密钥 (32+ 字符随机字符串) | ✅ |
| `ADMIN_API_TOKEN` | 管理面板 API Token | ✅ |
| `CORS_ORIGINS` | 允许的跨域来源 (默认 `*`) | 可选 |

### 自定义域名

1. 在 Cloudflare Dashboard → Workers → 你的项目 → Triggers → Custom Domains
2. 添加你的域名 (例如 `mm.snbar.top`)
3. DNS 记录会自动配置

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────┐
│                    用户浏览器                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Bitwarden   │  │ Bitwarden   │  │   Tirisfal  │  │
│  │ Chrome 扩展  │  │ 手机 App    │  │   Web 界面   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
└─────────┼────────────────┼────────────────┼─────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────┐
│              Cloudflare Workers (Edge)               │
│  ┌─────────────────────────────────────────────┐    │
│  │              Tirisfal API                    │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐    │    │
│  │  │ Auth     │ │ Vault    │ │ Send     │    │    │
│  │  │ Service  │ │ Service  │ │ Service  │    │    │
│  │  └──────────┘ └──────────┘ └──────────┘    │    │
│  └─────────────────────────────────────────────┘    │
│                          │                           │
│  ┌──────────────────────┼───────────────────────┐  │
│  │              Cloudflare D1 (SQLite)           │  │
│  │    users │ ciphers │ folders │ attachments    │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 技术栈

- **后端**: Cloudflare Workers (TypeScript)
- **数据库**: Cloudflare D1 (SQLite 边缘数据库) / KV
- **前端**: Preact + React Query + Tailwind CSS
- **加密**: AES-256-CBC + RSA-2048 + PBKDF2 (端到端)
- **协议**: Bitwarden API 兼容

---

## 📁 项目结构

```
tirisfal/
├── src/                    # Cloudflare Worker 后端
│   ├── services/          # 业务逻辑 (Auth, Vault, Backup...)
│   ├── handlers/          # HTTP 请求处理器
│   ├── router*.ts         # 路由 (public/authenticated/admin)
│   └── types.ts           # TypeScript 类型定义
├── webapp/                # 前端 Preact 应用
│   ├── src/
│   │   ├── components/    # UI 组件 (Vault, Admin, Settings...)
│   │   ├── lib/           # 核心库 (crypto, api, i18n...)
│   │   ├── hooks/         # React Hooks
│   │   └── styles/        # CSS 样式 (tokens, dark, vault...)
│   └── index.html         # 入口 HTML
├── shared/                # 前后端共享类型
├── migrations/            # D1 数据库迁移
├── wrangler.toml          # Cloudflare Workers 配置
└── package.json
```

---

## 🔧 开发指南

```bash
# 本地开发 (需要 Wrangler)
npm run dev

# 仅前端开发 (使用 Mock API)
npm run dev:demo

# 构建前端
npm run build

# 部署
npm run deploy

# 数据库迁移
npx wrangler d1 execute tirisfal-db --file=./migrations/xxx.sql
```

---

## 🤝 致谢

Tirisfal 基于 [NodeWarden](https://github.com/shuaiplus/nodewarden) 项目开发，感谢原作者的出色工作。

---

## 📄 许可证

[MIT License](LICENSE)

---

<div align="center">

**⭐ 如果 Tirisfal 对你有帮助，请给个 Star 支持一下！**

</div>

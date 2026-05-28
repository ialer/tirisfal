# Tirisfal Secrets Manager 重构计划

## 项目分析

Tirisfal 是 NodeWarden 的改进版，功能更完善，但仍然缺少 Secrets Manager 功能。

### 优势
- 更完善的备份系统
- 更好的导入/导出支持
- 更完善的 UI
- 代码质量有改进

### 需要添加的功能
- Machine Accounts（机器账号）
- Secrets（凭证管理）
- Projects（项目分组）
- Access Tokens（访问令牌）
- Audit Logs（审计日志）

## 重构策略

### 策略：基于 Tirisfal 扩展，而不是从头写

1. **复用现有架构** — Tirisfal 已有成熟的代码结构
2. **增量添加功能** — 只添加 Secrets Manager 相关模块
3. **保持兼容性** — 不破坏现有 Bitwarden 兼容功能
4. **统一代码风格** — 遵循 Tirisfal 的代码规范

## 实施步骤

### Phase 1: 数据库扩展 (1天)
- 创建 Secrets Manager 相关表
- 集成到现有 schema

### Phase 2: 核心服务 (2天)
- MachineAccountService
- SecretService
- ProjectService

### Phase 3: API 路由 (2天)
- Machine Accounts API
- Secrets API
- Projects API

### Phase 4: 权限控制 (1天)
- Machine Account 认证
- 项目级访问控制

### Phase 5: 审计日志 (1天)
- 访问日志记录
- 日志查询

### Phase 6: CLI 工具 (1天)
- nw CLI 工具

### Phase 7: Web UI (3天)
- Secrets Manager 管理界面

## 文件结构

```
src/
├── services/
│   ├── sm-schema.ts          # 新增：Secrets Manager 表结构
│   ├── sm-service.ts         # 新增：核心业务逻辑
│   └── storage-schema.ts     # 修改：集成 SM schema
├── handlers/
│   ├── sm-machine-accounts.ts # 新增：Machine Accounts API
│   ├── sm-secrets.ts         # 新增：Secrets API
│   └── sm-projects.ts        # 新增：Projects API
├── types/
│   └── sm.ts                 # 新增：SM 类型定义
├── router-sm.ts              # 新增：SM 路由
└── router.ts                 # 修改：集成 SM 路由
```

## API 设计

### Machine Accounts
- POST /api/machine-accounts
- GET /api/machine-accounts
- GET /api/machine-accounts/:id
- PUT /api/machine-accounts/:id
- DELETE /api/machine-accounts/:id
- POST /api/machine-accounts/:id/token

### Secrets
- POST /api/secrets
- GET /api/secrets
- GET /api/secrets/:id
- PUT /api/secrets/:id
- DELETE /api/secrets/:id

### Projects
- POST /api/projects
- GET /api/projects
- GET /api/projects/:id
- PUT /api/projects/:id
- DELETE /api/projects/:id

## Agent 调用方式

### HTTP API
```bash
# 获取凭证
curl https://tirisfal.workers.dev/api/secrets/XIAOMI_API_KEY \
  -H "Authorization: Bearer <access-token>"
```

### 环境变量注入
```bash
# 通过项目注入所有凭证
curl https://tirisfal.workers.dev/api/projects/SN-Team/secrets \
  -H "Authorization: Bearer <access-token>"
```

## 安全设计

### 加密
- 使用 Web Crypto API (AES-GCM)
- 密钥派生: PBKDF2
- 每个 Secret 独立加密

### 认证
- Access Token: JWT 格式
- 支持 Token 轮换
- Token 过期时间可配置

### 审计
- 所有访问记录
- IP 地址记录
- User Agent 记录

# Secrets Manager 安全检查清单

## 认证与授权

### Machine Account 认证
- [ ] Access Token 使用 SHA-256 哈希存储
- [ ] Token 支持过期时间
- [ ] Token 支持轮换
- [ ] 未认证访问被拒绝 (401)

### 用户认证
- [ ] 密码使用 PBKDF2/Argon2 哈希
- [ ] 支持 2FA (TOTP)
- [ ] 登录失败限制
- [ ] Session 安全管理

### 权限控制
- [ ] Machine Account 只能访问授权的 Project
- [ ] 用户只能管理自己的资源
- [ ] 权限检查在 API 层执行

## 数据安全

### 凭证加密
- [ ] 凭证值加密存储（AES-GCM）
- [ ] 密钥安全派生（PBKDF2）
- [ ] 每个凭证独立加密

### 传输安全
- [ ] HTTPS 强制
- [ ] API 请求验证
- [ ] CORS 配置正确

### 存储安全
- [ ] 敏感数据不存日志
- [ ] 错误信息不泄露细节
- [ ] 数据库访问限制

## 审计与监控

### 审计日志
- [ ] 所有凭证访问记录
- [ ] IP 地址记录
- [ ] User Agent 记录
- [ ] 操作类型记录

### 异常检测
- [ ] 高频访问告警
- [ ] 异常 IP 检测
- [ ] 权限提升检测

## 代码安全

### 输入验证
- [ ] 所有输入参数验证
- [ ] SQL 注入防护
- [ ] XSS 防护

### 错误处理
- [ ] 异常不泄露堆栈
- [ ] 错误信息标准化
- [ ] 敏感信息不返回

### 依赖安全
- [ ] 依赖版本检查
- [ ] 已知漏洞扫描
- [ ] 依赖锁定

## 部署安全

### 环境变量
- [ ] JWT_SECRET 安全配置
- [ ] 不使用默认密钥
- [ ] 密钥定期轮换

### 访问控制
- [ ] 最小权限原则
- [ ] API 速率限制
- [ ] DDoS 防护

## 检查命令

```bash
# 检查依赖漏洞
npm audit

# 检查敏感信息泄露
grep -r "password\|secret\|token" src/ --include="*.ts" | grep -v "test"

# 检查硬编码密钥
grep -r "sk-\|api_key\|secret" src/ --include="*.ts" | grep -v "test"
```

# Tirisfal 开发指南

## 🚀 快速开始

### 环境要求
- Node.js 20+
- npm 或 yarn

### 安装依赖
```bash
npm install
```

### 开发模式
```bash
npm run dev
```

---

## 📋 开发工作流

### 1. 代码规范

#### ESLint
```bash
# 检查代码
npm run lint

# 自动修复
npm run lint:fix
```

#### Prettier
```bash
# 格式化代码
npm run format

# 检查格式
npm run format:check
```

### 2. 类型检查
```bash
npm run typecheck
```

### 3. 测试
```bash
# 运行测试
npm run test

# 运行测试并生成覆盖率
npm run test:coverage
```

### 4. 构建
```bash
npm run build
```

---

## 🧪 测试指南

### 测试文件结构
```
tests/
├── handlers/          # 处理器测试
├── services/          # 服务测试
└── utils/             # 工具函数测试
```

### 编写测试
```typescript
import { describe, it, expect } from 'vitest';

describe('功能描述', () => {
  it('应该正确处理', () => {
    // 测试代码
    expect(result).toBe(expected);
  });
});
```

### 测试覆盖率
- 目标: 80%+
- 检查: `npm run test:coverage`

---

## 🔧 代码重构

### 重构原则
1. **单一职责** - 每个文件只做一件事
2. **小步迭代** - 每次只改一个小功能
3. **保持测试** - 重构后测试必须通过

### 重构大文件
参考: `REFACTOR-PLAN.md`

---

## 🚨 安全检查

### 环境变量
- 使用 `.dev.vars` 存储本地密钥
- 不要提交 `.dev.vars` 到 Git

### 依赖安全
```bash
npm audit
```

---

## 📚 文档

- `README.md` - 项目介绍
- `CONTRIBUTING.md` - 贡献指南
- `SECURITY-CHECKLIST.md` - 安全检查清单
- `DEVELOPMENT-FLOW.md` - 开发流程
- `REFACTOR-PLAN.md` - 重构计划

---

## 🎯 代码质量工具

| 工具 | 用途 | 命令 |
|------|------|------|
| ESLint | 代码检查 | `npm run lint` |
| Prettier | 代码格式化 | `npm run format` |
| Vitest | 单元测试 | `npm run test` |
| TypeScript | 类型检查 | `npm run typecheck` |

---

## 📈 CI/CD

GitHub Actions 自动运行:
- ✅ 代码检查 (Lint)
- ✅ 类型检查 (TypeCheck)
- ✅ 单元测试 (Test)
- ✅ 构建 (Build)

---

## 🔍 故障排除

### 常见问题

**Q: ESLint 报错怎么办？**
```bash
npm run lint:fix
```

**Q: 测试失败怎么办？**
```bash
npm run test -- --reporter=verbose
```

**Q: 类型错误怎么办？**
```bash
npm run typecheck
```

---

## 📞 联系方式

- 问题反馈: GitHub Issues
- 团队协作: SN Team

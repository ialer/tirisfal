# Tirisfal 代码重构计划

## 📋 重构目标

1. **降低代码复杂度** - 拆分大文件 (>500行)
2. **提高可测试性** - 添加单元测试
3. **统一代码风格** - ESLint + Prettier

---

## 🔧 重构任务

### 任务1: 拆分 backup.ts (1025行)

**当前问题**: 单个文件包含所有备份相关逻辑

**重构方案**:
```
src/handlers/backup.ts (1025行)
  ↓ 拆分为
src/handlers/backup/
├── index.ts                    # 主入口 (导出)
├── runner.ts                   # 备份运行器 (锁、调度)
├── admin.ts                    # 管理员API处理
├── restore.ts                  # 恢复逻辑
└── utils.ts                    # 工具函数
```

**具体拆分**:
1. **runner.ts** - 备份运行器
   - BackupRunnerLease 接口
   - acquireBackupRunnerLease()
   - releaseBackupRunnerLease()

2. **admin.ts** - 管理员API
   - handleBackupSettings()
   - handleBackupDestination()
   - handleBackupNow()

3. **restore.ts** - 恢复逻辑
   - handleBackupRestore()
   - importBackupArchive()

4. **utils.ts** - 工具函数
   - isAdmin()
   - writeAuditLog()
   - getBackupDestinationSummary()

---

### 任务2: 拆分 backup-import.ts (933行)

**重构方案**:
```
src/services/backup-import.ts (933行)
  ↓ 拆分为
src/services/backup-import/
├── index.ts                    # 主入口
├── parser.ts                   # 解析逻辑
├── validator.ts                 # 验证逻辑
├── importer.ts                 # 导入逻辑
└── types.ts                    # 类型定义
```

---

### 任务3: 拆分 ciphers.ts (923行)

**重构方案**:
```
src/handlers/ciphers.ts (923行)
  ↓ 拆分为
src/handlers/ciphers/
├── index.ts                    # 主入口
├── crud.ts                     # CRUD操作
├── share.ts                    # 分享逻辑
├── folders.ts                  # 文件夹操作
└── attachments.ts              # 附件处理
```

---

## 📊 重构优先级

| 优先级 | 文件 | 当前行数 | 目标行数 | 复杂度 |
|--------|------|----------|----------|--------|
| P0 | backup.ts | 1025 | <300 | 高 |
| P1 | backup-import.ts | 933 | <300 | 高 |
| P1 | ciphers.ts | 923 | <300 | 中 |
| P2 | accounts.ts | 830 | <250 | 中 |
| P2 | backup-uploader.ts | 789 | <250 | 中 |

---

## 🧪 测试策略

### 测试覆盖目标

| 模块 | 目标覆盖率 | 测试类型 |
|------|------------|----------|
| handlers | 80% | 单元测试 |
| services | 85% | 单元测试 |
| utils | 90% | 单元测试 |

### 测试文件结构

```
tests/
├── handlers/
│   ├── backup.test.ts
│   ├── ciphers.test.ts
│   └── accounts.test.ts
├── services/
│   ├── backup-import.test.ts
│   ├── backup-uploader.test.ts
│   └── storage.test.ts
└── utils/
    ├── response.test.ts
    └── uuid.test.ts
```

---

## 📝 执行步骤

### Phase 1: 工具配置 (已完成)
- [x] 添加 ESLint 配置
- [x] 添加 Prettier 配置
- [x] 添加 Vitest 配置
- [x] 更新 package.json

### Phase 2: 拆分 backup.ts
- [ ] 创建 backup/ 目录结构
- [ ] 提取 runner.ts
- [ ] 提取 admin.ts
- [ ] 提取 restore.ts
- [ ] 提取 utils.ts
- [ ] 更新导入路径
- [ ] 添加单元测试

### Phase 3: 拆分 backup-import.ts
- [ ] 创建 backup-import/ 目录结构
- [ ] 提取 parser.ts
- [ ] 提取 validator.ts
- [ ] 提取 importer.ts
- [ ] 添加单元测试

### Phase 4: 拆分 ciphers.ts
- [ ] 创建 ciphers/ 目录结构
- [ ] 提取 crud.ts
- [ ] 提取 share.ts
- [ ] 提取 folders.ts
- [ ] 添加单元测试

### Phase 5: 验证
- [ ] 运行测试
- [ ] 运行 lint
- [ ] 运行 typecheck
- [ ] 验证功能

---

## ⚠️ 注意事项

1. **保持向后兼容**
   - 重构后导出接口不变
   - 更新导入路径

2. **逐步重构**
   - 每次只重构一个文件
   - 确保测试通过

3. **文档更新**
   - 更新 DEVE LOPMENT-FLOW.md
   - 添加重构说明

---

## 📚 参考

- [TypeScript重构最佳实践](https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html)
- [Vitest测试指南](https://vitest.dev/guide/)
- [ESLint配置](https://eslint.org/docs/latest/use/configure/)

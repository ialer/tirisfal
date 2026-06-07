# ciphers.ts 重构任务清单

## 📋 问题分类

### 1. 类型安全问题 (优先级 P0)

#### 1.1 any 类型使用 (需要添加类型注解)
- [ ] 第41行: `getAliasedProp` 函数参数 `source: any`
- [ ] 第45行: 不安全的赋值
- [ ] 第52行: 返回值类型
- [ ] 第65行: 函数参数类型
- [ ] 第75行: 函数参数类型

#### 1.2 normalizeCipherLoginForStorage 函数
- [ ] 第135-136行: 不安全的赋值
- [ ] 第145行: fido2Credentials 类型

#### 1.3 normalizeCipherLoginForCompatibility 函数
- [ ] 第149行: fido2Credentials 访问
- [ ] 第153-161行: uris 数组处理

#### 1.4 normalizeFido2CredentialsForCompatibility 函数
- [ ] 第173行: credential 类型

### 2. 代码规范问题 (优先级 P1)

#### 2.1 使用 === 替代 ==
- [ ] 第27行: `value == null`
- [ ] 第59行: `value == null`
- [ ] 第117行: `value == null`
- [ ] 第161行: `uri.match != null`

### 3. 导入排序问题 (已自动修复)

---

## 🔧 修复步骤

### Step 1: 添加类型定义

在 `src/types/ciphers.ts` 中添加:
```typescript
// 用于处理未知的客户端字段
interface CipherClientData {
  [key: string]: unknown;
}

// URI 对象类型
interface CipherUri {
  uri?: string;
  uriChecksum?: string;
  match?: number | null;
  [key: string]: unknown;
}

// FIDO2 凭证类型
interface Fido2Credential {
  credentialId: string;
  keyType: string;
  keyAlgorithm: string;
  keyCurve: string;
  keyValue: string;
  rpId: string;
  counter: string;
  discoverable: string;
  userHandle?: string;
  userName?: string;
  rpName?: string;
  userDisplayName?: string;
  [key: string]: unknown;
}
```

### Step 2: 修复 getAliasedProp 函数

```typescript
function getAliasedProp(
  source: Record<string, unknown> | null | undefined,
  aliases: string[]
): { present: boolean; value: unknown } {
  if (!source || typeof source !== 'object') return { present: false, value: undefined };
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return { present: true, value: source[key] };
    }
  }
  return { present: false, value: undefined };
}
```

### Step 3: 修复 readCipherProp 函数

```typescript
function readCipherProp<T = unknown>(
  source: Record<string, unknown> | null | undefined,
  aliases: string[]
): { present: boolean; value: T | undefined } {
  return getAliasedProp(source, aliases) as { present: boolean; value: T | undefined };
}
```

### Step 4: 修复 normalizeCipherLoginForStorage

```typescript
export function normalizeCipherLoginForStorage(
  login: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!login || typeof login !== 'object') return login ?? null;
  return {
    ...login,
    fido2Credentials: Array.isArray(login.fido2Credentials) ? login.fido2Credentials : null,
  };
}
```

### Step 5: 修复 normalizeCipherLoginForCompatibility

```typescript
export function normalizeCipherLoginForCompatibility(
  login: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  const normalized = normalizeCipherLoginForStorage(login);
  if (!normalized || typeof normalized !== 'object') return normalized ?? null;
  const next = sanitizeEncryptedObject(normalized, ['username', 'password', 'totp', 'uri']);
  if (!next) return null;
  next.uris = Array.isArray(next.uris)
    ? (next.uris as CipherUri[])
        .map((uri) => sanitizeEncryptedObject(uri, ['uri', 'uriChecksum']) as CipherUri)
        .filter((uri) => !!uri && (uri.uri || uri.uriChecksum || uri.match != null))
    : null;
  next.fido2Credentials = normalizeFido2CredentialsForCompatibility(next.fido2Credentials);
  return next;
}
```

### Step 6: 修复 normalizeFido2CredentialsForCompatibility

```typescript
function normalizeFido2CredentialsForCompatibility(
  credentials: unknown
): Fido2Credential[] | null {
  if (!Array.isArray(credentials) || credentials.length === 0) return null;
  // ... 保持现有逻辑，但添加类型
}
```

### Step 7: 修复 === 问题

将所有 `== null` 替换为 `=== null`
将所有 `!= null` 替换为 `!== null`

---

## 📊 预期结果

| 问题类型 | 当前数量 | 目标数量 |
|----------|----------|----------|
| any 类型 | ~20 | 0 |
| == 问题 | 4 | 0 |
| 类型安全错误 | ~30 | 0 |

---

## ✅ 验证步骤

1. 运行 ESLint 检查
   ```bash
   npx eslint src/handlers/ciphers.ts
   ```

2. 运行 TypeScript 类型检查
   ```bash
   npx tsc --noEmit
   ```

3. 运行测试
   ```bash
   npm run test
   ```

---

## 🎯 目标

- 消除所有 `any` 类型使用
- 消除所有 `==` 问题
- 保持功能不变
- 提高代码可维护性

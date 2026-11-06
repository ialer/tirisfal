# 安全复核与修正报告：注入代理 / JWT / 加密工具

> 复核对象：`ialer/tirisfal` main（2026-10-31 快照，v1.6.0）
> 复核日期：2026-11-06
> 结论：6 条风险全部**在代码层复现**，其中 4 条已修复并补回归测试，2 条受平台能力限制改为「缓解 + 明确残余风险」。

## 一、结论总览

| # | 风险 | 代码核实 | 原评级 | 复核评级 | 处理 |
|---|---|---|---|---|---|
| 1 | 注入代理仅校验主机名字符串，无法防 DNS rebinding | 属实（`sm-secrets.ts:60-73`） | 中 | 中（云端由 CF 出站策略兜底，自建环境才是真风险） | 静态校验加固 + 可选逐次 DNS 解析校验（`OUTBOUND_DNS_GUARD=1`）+ 残余风险文档化 |
| 2 | 响应脱敏仅 `secretValue.length >= 8` 时执行 | 属实（`sm-secrets.ts:328-329`） | 低至中 | 中（短 API key / 口令片段直接回显） | 任何长度都脱敏，并覆盖 URL 编码 / base64 / base64url 变体 |
| 3 | `verifyJWT` 未校验 `payload.typ` | 部分属实：`jwt.ts` 未校验，但调用方 `auth.ts:236` 有 `typ && typ !== 'access'` 兜底（且放行无 typ 的存量令牌） | 中 | 低至中（现有令牌类型都自带 typ，实际可利用面窄；属纵深防御缺口） | `verifyJWT` 强制 `typ === 'access'`（另加 `alg === 'HS256'`、`sub` 类型校验） |
| 4 | 签发/验证均无 `aud` | 属实 | 低 | 低 | 签发写入 `aud=tirisfal-api`，校验强制比对 |
| 5 | HKDF 快速路径 salt/info 硬编码，派生密钥不随调用唯一 | 属实（`crypto.ts:55-56`，全库共用一把派生密钥） | 低 | 低至中（单密钥泄露后所有记录同一把数据密钥，跨记录无隔离） | 新增 v3 格式：每次加密随机 16 字节 salt 写入密文，HKDF 逐条派生；v2 只读兼容 |
| 6 | PBKDF2 兼容路径 100,000 次迭代低于基线 | 属实（`crypto.ts:39`），但 **Workers Web Crypto 的 PBKDF2 迭代上限就是 100,000**（见 `services/auth.ts:8` 注释） | 低 | 低（主密钥是高熵随机值，非口令；仅存量密文受影响） | 无法靠调高迭代修复：保持上限、把新写入全部改为 v3（无 PBKDF2），并在读取时把存量密文透明升级为 v3 |

复核过程中另外发现并一并修掉两处**同类纵深问题**：

- `allowed_hosts` 的 `*.example.com` 实际匹配多级子域（`a.b.example.com`），与注释写的「单层通配」不符 → 收紧为单层。
- 目标 URL 允许内嵌 `user:pass@`（会进审计与上游请求语义），且主机名未去尾部根点（`api.example.com.`）→ 一律拒绝内嵌凭证、先规范化再比对。

## 二、逐条证据与修复

### 1. 注入代理 SSRF / DNS rebinding

原实现（`src/handlers/sm-secrets.ts`）：

```ts
const host = url.hostname.toLowerCase();
if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return 'IP literal ...';
if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) return 'Private hosts ...';
```

实测（WHATWG URL 与 Workers `fetch` 一致）：

| 输入 | `url.hostname` | 旧校验结果 |
|---|---|---|
| `https://2130706433/`、`https://0x7f000001/`、`https://127.1/` | 归一为 `127.0.0.1` | 拦住（URL 已归一） |
| `https://[::ffff:127.0.0.1]/` | `[::ffff:7f00:1]` | 拦住（含 `:`） |
| `https://localhost./` | `localhost.` | **漏过本地域名规则**（正则带 `$`） |
| `https://10.0.0.1.nip.io/`（白名单域名解析到内网） | 原样 | **静态校验无法判定**，即 DNS rebinding 面 |

修复：

- 新增 `src/utils/outbound-guard.ts`：主机名规范化（去尾点）、IP 字面量识别、IPv4/IPv6 私网与保留网段判定、单层通配白名单匹配、响应脱敏。
- `assertOutboundTarget()` = 静态校验 + 可选 `checkHostResolution()`（DoH，`A`/`AAAA` 任一命中私网即拒绝；解析不可用时失败关闭）。
- 开关：`OUTBOUND_DNS_GUARD=1`。默认关闭，避免自建内网部署（如放行 `http://10.126.126.x` 的分支）因无法访问 DoH 而全量 403。

**残余风险（必须由部署侧兜底）**：DoH 预解析与 `fetch` 的真实解析之间仍有 TOCTOU 窗口；Workers 无法钉死解析结果。权威控制在出口策略——Cloudflare 默认禁止向 RFC1918 出站；自建 workerd 请用防火墙只放行白名单目标。

### 2. 响应脱敏阈值

原实现：`secretValue.length >= 8 ? text.split(secretValue).join('***REDACTED***') : text`。
短凭证（如 6 位内部 token、口令片段）被上游回显时**原样返回给 machine account**。

修复：`redactSecret()` 无条件脱敏，且同时替换原文、URL 编码、base64、base64url 变体（长串优先替换）。回归：`tests/handlers/sm-secrets-use.test.ts` → 「短凭证（<8 字符）也必须被脱敏」。

### 3. JWT `typ`

原 `verifyJWT` 只校验签名、`iss`、`exp`；`typ` 校验在调用方 `auth.ts`，且写成 `if (payload.typ && payload.typ !== 'access')`——**无 typ 的令牌一律放行**。

修复（`src/utils/jwt.ts`）：`verifyJWT` 内强制 `iss === 'tirisfal'`、`aud === JWT_AUDIENCE`、`typ === 'access'`、`sub` 为非空字符串、`exp`/`iat` 为数字且 `iat` 不得超前 60s，并显式要求头部 `alg === 'HS256'`。`auth.ts` 的调用方检查保留作第二层防御并改为严格比较。

### 4. JWT `aud`

原实现无 `aud`。修复：`createJWT` 写入 `aud: 'tirisfal-api'`（导出常量 `JWT_AUDIENCE`），`verifyJWT` 强制等值比对。

**行为变化**：升级后**既有访问令牌全部失效**（最长 2 小时自然过期，见 `LIMITS.auth.accessTokenTtlSeconds = 7200`）。客户端需走 refresh_token（DB 有记录，不受影响）。不接受「兼容期」放行，否则 aud 形同虚设。

### 5. HKDF 硬编码 salt/info

原 v2：`HKDF_SALT = HKDF_INFO = 'tirisfal-value-v2'`，且按 masterKey 缓存派生结果——全库所有凭证共用一把 AES 密钥，跨记录无隔离。

修复：新增 **v3** 格式 `v3:<base64(salt16 + iv12 + tag + ct)>`，每次加密随机 salt，HKDF-SHA-256 + `info='tirisfal-value-v3'` 逐条派生，密钥不再缓存（HKDF 开销可忽略）。`decryptFast` 同时支持 v3 / v2 / 旧 PBKDF2 三种格式；v2 只读路径保留原缓存。

### 6. PBKDF2 100k

`deriveKey()` 的 100,000 次是 **Cloudflare Workers Web Crypto 的硬上限**（`auth.ts:8` 注释已记录），调高会直接抛错，因此不能靠加迭代修复。真实缓解：

1. 新写入不再走 PBKDF2（全部 v3 + HKDF）；
2. `SecretsManagerService.decryptAndUpgradeSecretValue()` 在读取存量密文时自动用 v3 重写（带 `id + user_id + project_id` 归属条件，缺一不写，失败不阻断读取）；
3. 存量密文在被首次读取前仍以 100k PBKDF2 保护——这正是「主密钥高熵、非口令」前提下可接受的部分。

## 三、兼容性与部署注意

| 变化 | 影响 | 处置 |
|---|---|---|
| 访问令牌新增 `aud` 且强制校验 | 升级瞬间旧 access token 全部失效 | 客户端走 refresh_token 重新签发；刷新令牌不受影响 |
| 无 `typ` 的令牌不再放行 | 仅影响 v1.6.0 之前签发、尚未过期的令牌 | 同上，2 小时内自愈 |
| `*.example.com` 收紧为单层 | 依赖多级通配的 grant 会开始 403 | 检查 `allowed_hosts`，多级子域请显式列出 |
| 密文格式新增 v3 | 旧版本代码无法读取 v3 密文 | 不可回滚到旧版本；如需回滚，先导出凭证 |
| `OUTBOUND_DNS_GUARD` | 默认关闭；开启后 DoH 不可用即 403 | 云端建议开启；自建且需访问内网时保持关闭并依赖出口防火墙 |

## 四、验证记录

```
$ ./node_modules/.bin/vitest run
Test Files  10 passed (10)
     Tests  96 passed (96)      # 基线 69 → 新增 27 条安全回归

$ ./node_modules/.bin/tsc --noEmit      # 无输出（通过）
$ ./node_modules/.bin/eslint <改动文件>  # 0 error
$ node scripts/check-security-gates.mjs
扫描 70 个文件：24 处命中，其中新增 0 处
✓ 无新增违规
```

新增回归用例：

- `tests/utils/jwt.test.ts`（8）：typ 混淆、无 typ、aud 不匹配/缺失、非 HS256、过期、iat 超前、签名篡改。
- `tests/utils/outbound-guard.test.ts`（12）：尾点归一、数字/IPv6 字面量、私网网段、单层通配、短凭证脱敏、编码变体、DoH 私网拒绝/公网放行/失败关闭。
- `tests/handlers/sm-secrets-use.test.ts`（+5）：短凭证脱敏、尾点主机、多级子域拒绝、URL 内嵌凭证拒绝、DNS guard 命中内网时 403 且不打上游。
- `tests/services/crypto.test.ts`（+2）：v3 每条 salt 不同、真实 v2 样本可解。

## 五、改动文件

| 文件 | 变更 |
|---|---|
| `src/utils/outbound-guard.ts` | 新增：主机名/网段/白名单/脱敏/DoH 解析校验 |
| `src/handlers/sm-secrets.ts` | 出站校验接入 guard，脱敏无条件化，读取路径改为带归属信息的升级读取 |
| `src/utils/crypto.ts` | 新增 v3（逐条随机 salt），保留 v2 / PBKDF2 只读兼容，导出 `isLegacyCiphertext` |
| `src/services/sm-service.ts` | 新增 `decryptAndUpgradeSecretValue`（读取时透明升级存量密文） |
| `src/utils/jwt.ts` | `aud` 签发+校验、`typ` 强制、`alg` 白名单、`sub`/`iat` 校验 |
| `src/services/auth.ts` | 调用方 `typ` 检查改为严格比较（第二层防御） |
| `src/types/index.ts` | `JWTPayload.aud`、`Env.OUTBOUND_DNS_GUARD` |
| `tests/**` | 上述回归用例 + 适配 mock |

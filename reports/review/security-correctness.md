# 安全与正确性审查（第二轮 · 上一轮未覆盖面）

> 仓库：`/data/开发/tirisfal`，基线 `main@8693cb6`（含未提交容器化改动）
> 审查人：security-reviewer（团队 code review）
> 范围：认证与会话（identity/accounts/auth）、备份链路（backup-*）、附件与 Send（attachments/sends/blob-store/direct-upload）、输入校验与注入面（SQL/路径/icon-proxy）、密码学实现、越权与 IDOR
> 不在范围（上一轮已修并合并，不重复）：注入代理 SSRF/脱敏、JWT `typ`/`aud`/`alg`、v3 逐条 salt、客户端 IP 信任链（`docs/SECURITY-REVIEW-2026-11-06.md`、`src/utils/client-ip.ts`）
> 方法：只读源码 + 只读命令（grep/read、`node scripts/check-security-gates.mjs`、本地 `node:sqlite` 语义复现），未构建、未跑测试。

---

## 评分

| 维度 | 分 | 一句话理由 |
|---|---|---|
| 认证与会话 | 3/5 | TOTP 防重放与 password 轮换做得扎实，但 refresh token 重用检测实际不可达、认证后敏感端点零速率限制 |
| 备份链路 | 2/5 | 恢复路径因导出剥离 `master_password_hash` 撞 NOT NULL 而必然失败；解压先于大小校验；无管理员公钥时凭据明文落库 |
| 附件与 Send | 2/5 | 归属校验齐全、下载令牌一次性，但下载响应原样透传客户端可控 Content-Type 且同源内联渲染，等于自建 XSS 通道 |
| 输入校验与注入面 | 4/5 | 全部 `prepare()` 插值均为硬编码列名/表名，无 LIKE 拼接，路径段有 `..` 过滤；剩余问题集中在 icon-proxy 与响应头 |
| 密码学使用 | 4/5 | v3 每次随机 salt + HKDF 正确，常量时间比较普遍到位；缺口是密文无 AAD 上下文绑定、备份运行时密钥复用 JWT_SECRET |
| 越权 / IDOR | 4/5 | 逐个人工过 `getCipher`/`getSend`/`getMachineAccount`/`getSecret` 调用点，均有 `userId` 归属比较；未发现可复现的跨租户读取 |

**总评：2/5**（存在 1 条可构成完整账户接管的 P0 与 5 条 P1；上一轮修过的面上手较硬，问题集中在本轮新扩的面）

---

## 发现

### P0-1 Send / 附件下载原样透传客户端可控 `Content-Type`，同源渲染 → 会话接管

**事实**
- 上传时保存的 MIME 完全来自请求：`src/utils/direct-upload.ts:120-123`（非 multipart 用请求头 `content-type`）、`:97-101`（multipart 用 `file.type`）；落库写进对象元数据：`src/handlers/sends-private.ts:64-72`、`src/handlers/attachments.ts:75-83`。
- 下载时原样回写该 MIME，且**没有** `Content-Disposition`：`src/handlers/sends-public.ts:305-311`、`src/handlers/attachments.ts:405-411`。
- 两条下载路由是公开路由且无 rate limit：`src/router-public.ts:219-222`（`GET /api/sends/:id/:fileId`）、`:145-153`（`GET /api/attachments/:cipherId/:attachmentId`）。
- 全站响应统一加 CSP，带 `script-src 'self' 'unsafe-inline'`：`src/utils/response.ts:109-127`（`'unsafe-inline'` 在 `:119`），且 `src/index.ts:118` 对 `handleRequest` 的所有响应套用。
- Send 文件下载令牌只校验 `sendId/fileId`，不校验 Send 是否仍可用：`src/handlers/sends-public.ts:286-303`。

**影响**：任意持号用户（邀请制，但包含被盗的低权账号）可上传一份 `Content-Type: text/html` 的"文件"，把 `/api/sends/{id}/{fileId}?t=...` 链接发给受害者；受害者点开即在本服务同源执行脚本。配合 `SameSite=Strict` 的 refresh cookie（`src/handlers/identity.ts:69-80`，Path=`/identity/connect`）与 `script-src 'unsafe-inline'`，脚本可自行换发 access token 并调 `/api/sync`，再把结果通过顶层跳转外带（CSP 未设 `navigate-to`）。等价于「点链接即被接管账户」。

**可利用性**：高（判断）。前置条件是攻击者持有一个有效账号并能创建 Send；受害者点击即可，无需任何交互确认。`X-Content-Type-Options: nosniff` 不阻止已声明为 `text/html` 的文档渲染。

**建议**（按优先级）：下载响应固定 `Content-Type: application/octet-stream` + `Content-Disposition: attachment; filename*=UTF-8''…`；`Content-Security-Policy` 追加 `sandbox`（断开同源）；`script-src` 去掉 `'unsafe-inline'`（webapp 用 nonce/hash）；下载令牌签发时同时绑定 `send.deletionDate` 与 `isSendAvailable` 的结果，下载前复查一次。

---

### P1-2 备份恢复必然失败：导出剥离 `master_password_hash`，导入写 NOT NULL 列

**事实**
- 导出 SQL 取到了该列（`src/services/backup-archive.ts:453-455`），但随后从行里删除：`src/services/backup-archive.ts:130-136`、`:138-148`（`clean` 用 `delete`）。
- 导入的用户列白名单里**包含**它：`src/services/backup-import.ts:675-702`（`'master_password_hash'` 在 `:683`），绑定值用 `row[column] ?? null`：`:431-434`。
- 表定义 `master_password_hash TEXT NOT NULL`：`migrations/0001_init.sql:23`；恢复用的影子表由 `sqlite_master` 原样重写而来：`src/services/backup-import.ts:86-115`、`:126-133`。
- 恢复路径没有任何回填/占位逻辑（grep `masterPasswordHash|master_password_hash` 在 `handlers/backup.ts`、`services/backup-import.ts` 仅命中该列表项）。

**影响**：任何一次真实灾难恢复（`/api/admin/…/import` 或远端归档恢复）都会在写影子表阶段抛 `NOT NULL constraint failed: users.master_password_hash`。因为先写影子表、最后才 swap（`src/services/backup-import.ts:155-167`），线上数据不会被破坏，但**备份等于不可恢复**——这是数据可用性层面的 P1。次要后果（判断，待确认）：若日后放开该约束，恢复出来的账号 `masterPasswordHash` 为 `null`，`AuthService.verifyPassword` 会走 `storedHash.startsWith('$s$')`（`src/services/auth.ts:160`）并抛 TypeError，登录接口 500。

**可利用性**：不需要攻击者，属于"事故时才暴露"的功能性致命缺陷；攻击者也可借此拒止恢复（把管理员引向 restore 失败）。

**建议**：导出保留 `master_password_hash`（它本身是服务端二次哈希，且备份包已含加密的 `key`，剥离并不提升机密性），或导入时写入一个显式的 `$s$…` 占位并置 `ForcePasswordReset`；同时把"导出字段集合 == 导入列集合 ∧ 满足 NOT NULL"做成断言，在 CI 里跑一次真实的 round-trip。

---

### P1-3 固定窗口限流的 UPSERT 在换窗后永久失效（已用 sqlite 语义复现）

**事实**
- `src/services/ratelimit.ts:202-209`：`INSERT … ON CONFLICT(key) DO UPDATE SET count = count + 1 … WHERE window_start = excluded.window_start`。
- 读取时要求窗口相等：`:211-216`（`SELECT count … WHERE key = ? AND window_start = ?`），取不到就 `count = 1`（`:216`）。
- 本地 `node:sqlite` 复现：同窗口连打 5 次 → `count=5, window_start=100`；窗口翻到 200 后再打两次 → 行仍是 `count=5, window_start=100`，而"新窗口查询"返回 0 行 → 调用方认为 `count=1`，永远 `allowed`。

**影响**：所有走 `consumeBudget`/`consumeBudgetWithWindow` 的配额在"该 key 第一次出现的那个窗口"之后不再生效，直到随机的过期清理（`:176-185`，概率 5%、最短间隔 10 分钟）删掉陈旧行。受影响配置：`apiRequestsPerMinute=200`、`publicRequestsPerMinute=60`、`refreshTokenRequestsPerMinute=30`、`registerRequestsPerMinute=5`、`passwordHintRequestsPerMinute/Hour`（`src/config/limits.ts:39-70`），即登录喷洒的 IP 预算之外的**大部分限流实际是装饰**。（登录/2FA 走的是 `login_attempts_ip` 的另一套 UPSERT，`:121-127`，不受影响——这点上一轮没漏。）

**可利用性**：高（判断）。攻击者只需等 60 秒让窗口滚动一次，之后在同一 key 上可无限速请求；缓存/清理节奏只影响"多久被短暂恢复"。

**建议**：改成一条语句完成"换窗则重置、同窗则自增"，例如 `ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END, window_start = excluded.window_start, expires_at = excluded.expires_at`，然后按 `(key, window_start)` 读；并补一条"跨窗口连续请求仍被限制"的回归用例。

---

### P1-4 refresh token 重用检测不可达：轮换先把旧 token 压到宽限期内过期

**事实**
- 轮换时先压缩旧 token 过期时间：`src/handlers/identity.ts:658-663` → `constrainRefreshTokenExpiry`（`src/services/storage-refresh-token-repo.ts:173-198`，语义是 `expires_at = min(原值, now + 60s)`）。
- 紧接着写 `rotated_at = now`：`src/handlers/identity.ts:664-665` → `markRefreshTokenRotated`（`src/services/storage-refresh-token-repo.ts:128-138`）。
- 重用检测条件是 `now - rotatedAt > 60s ∧ familyId`：`src/services/auth.ts:279-287`；而 `getRefreshTokenRecord` 在 `expires_at < now` 时**直接删行并返回 null**（`src/services/storage-refresh-token-repo.ts:103-106`），根本到不了重用判断。
- 只要 `expires_at = rotatedAt 起点 + 60s`，则任何"还能读到该行"的时刻都满足 `now - rotatedAt < 60s`，条件恒假。

**影响**：`revokeRefreshTokenFamily` 这条防线在本仓库内**不可达**（判断，基于上述两条不变式；除非有人外部改写 `expires_at`）。真实行为退化为：旧 refresh token 在轮换后 60 秒内可被**任意次数**重放，每次都能换出一枚新的、同家族的有效 refresh token（每秒最多受 30 次/IP 限制），而家族撤销永远不会触发——被盗 token 与合法客户端的并发使用不会被察觉。

**可利用性**：中高（判断）。攻击者窃取 refresh token 后 60 秒内可无限续期；超过 60 秒则因过期静默失败，日志里只有一次无关的 `invalid_grant`。

**建议**：把旧行保留到 `expires_at`（不压缩到宽限期），重放判定改为"同家族里出现 `rotated_at` 非空的行被再次使用即撤销"，并把宽限期只用于**同请求幂等返回**（缓存上一次轮换结果）而不是续命；补 `familyId` 为空的存量 token 路径的单测。

---

### P1-5 备份导入：先整包解压再校验大小，且 import 路由被豁免 body 上限

**事实**
- `unzipSync(bytes)` 在最前面执行：`src/services/backup-archive.ts:256-262`；解压后**才**累加 `totalExtractedBytes` 并比较 64 MiB 上限：`:269-279`。
- 归档体积上限检查也在解压之后才有意义（`:212-218` 只查压缩包 64 MiB）。
- 导入路由被显式排除在 25 MiB body 限制之外：`src/router.ts:55-60`（`path === '/api/admin…import'`）；随后 `await request.formData()`（`src/handlers/backup.ts:1145-1163`）把整个 multipart 全量缓冲进内存，再 `new Uint8Array(await file.arrayBuffer())`。

**影响**：一个 60 MiB 的 zip bomb（高压缩比 JSON/重复条目）可在 worker 内解出数 GiB，或使 `formData()` 直接吃满内存 → 1102/OOM 崩溃、实例重启；单次请求即可拒止服务（管理员会话即可触发，被盗管理员 token 下也一样）。

**可利用性**：中（需管理员令牌），但一旦触发影响面是全实例。同类问题在 `parseBackupArchive` 的每次调用（本地导入、远端恢复）都成立。

**建议**：先按 ZIP 中央目录算出 `uncompressedSize` 总和并拒绝超限（fflate 支持只读目录），再逐条流式解压并累计；给 import 路由单独设 `Content-Length` 上限（与归档上限一致）；条目数上限 `:265-267` 保留但提前到解压前。

---

### P1-6 无管理员公钥时，备份设置（S3 secret / WebDAV 口令）被静默降级为明文落库

**事实**
- 契约写明"不要将提供商密钥存储为明文配置 JSON"：`src/services/backup-settings-crypto.ts:3-12`。
- 但导入归一化在 `hasPortableAdmins === false` 时直接 `return serializeBackupSettings(settings)`：`src/services/backup-config.ts:507-517`（envelope 分支）、`:524-534`（明文分支）；`serializeBackupSettings` 就是 `JSON.stringify`：`:425-427`。
- "有公钥的管理员"判定依赖 `users.public_key`：`src/services/backup-settings-crypto.ts:163-178`。
- 明文落库后读回时也不会再加密：`src/services/backup-config.ts:441-447`（非 envelope 分支走 `saveBackupSettings`，但语义上是"当作明文设置"）。

**影响**：以下任一场景会把 S3 `secretAccessKey` / WebDAV 口令以明文写进 `config` 表：① 恢复一个早期/手工构造、`users.public_key` 为空的归档；② 恢复后没有任何 `active` 且带公钥的 admin（例如管理员账号被 ban 的瞬间执行 settings 归一化）。明文凭据随后会出现在数据库、D1 导出、以及 `GET /api/admin/…/settings` 的响应里（`src/handlers/backup.ts:594-605`，无脱敏，见 P2-11）。

**可利用性**：低（需要管理员动作/特定状态），但后果是不可逆的凭据外泄（配置表随备份一起流转）。

**建议**：无公钥管理员时**拒绝**写入并抛出明确错误（让管理员先补公钥），不要降级明文；历史明文设置读取后强制用 `encryptBackupSettingsEnvelope` 重写；给 `serializeBackupSettings` 加断言，禁止包含 `secretAccessKey`/`password` 的对象进入明文路径。

---

### P1-7 icon-proxy 透传第三方 `image/svg+xml` 到本站源（潜在存储型 XSS）

**事实**
- 上游响应的 `Content-Type` 只要以 `image/` 开头就原样回写：`src/services/icon-proxy.ts:104-106`、`:114`、`:124`。
- 代理目标是对**用户可控域名**做第三方抓取（`favicon.im` / `icons.bitwarden.net`）：`:91-98`，域名只做了字符/URL 归一校验（`:16-32`，不拦 IP 字面量，但因为 URL 前缀固定所以不构成对内网 SSRF）。
- 路由公开且**没有** rate limit：`src/router-public.ts:137-142`。
- 响应同样带上 `script-src 'self' 'unsafe-inline'` 的 CSP：`src/utils/response.ts:114-127`。

**影响**：若上游对"攻击者自有域名声明的 SVG 图标"不做类型改写（**待确认**：favicon.im 是否会把 SVG 强制转为 PNG），则 `/icons/<attacker-host>/icon.png` 会以 `image/svg+xml` 返回同源可执行 SVG，构成与 P0-1 同级的同源 XSS；即便上游已改写，`Content-Type` 直通仍是无必要的信任外溢。另有两点确定性问题：① `resp.body` 直出与 `await resp.arrayBuffer()`（`:106`、`:117`）无体积上限；② 公开路由无限流，二者叠加可做带宽/内存放大。

**可利用性**：中（判断，取决于上游 Content-Type 行为）；确定可利用的部分是"无限流 + 无体积上限"的放大面。

**建议**：代理响应用**固定** `Content-Type: image/png`（或按魔数嗅探后只放行 png/jpeg/webp/ico，显式拒绝 svg），加 `Content-Disposition: inline` + `CSP: sandbox`；给 icon 路由接 `publicReadRequestsPerMinute`；对上游响应设 `Content-Length` 上限（如 512 KiB）并改用流式拷贝+截断。

---

### P2-8 认证后的 password 校验类端点零速率限制，且每次都跑 100k 次 PBKDF2（CPU 放大）

**事实**：`src/handlers/accounts.ts` 全文没有 `consumeBudget`/`checkLoginAttempt` 调用（grep 无命中），而这些端点每次都做服务端二次哈希：
- `/api/accounts/verify-password`：`:862-897`（`auth.verifyPassword` 在 `:887`）
- `/api/accounts/keys`：`:493-504`
- `/api/accounts/password`（改密）：`:555-558`
- `/api/accounts/api-key` / `rotate-api-key`：`:941-946`
- 二次哈希迭代 100k：`src/services/auth.ts:10`、`:136-154`

**影响**：① 拿到一枚 access token（2 小时）后，可对 `masterPasswordHash` 做**不限次**在线爆破（每次请求 = 服务端一次 100k PBKDF2，同时是 CPU 放大向量）；② 只有全局 `apiRequestsPerMinute=200` 一道闸，而该闸本身受 P1-3 影响近乎失效。

**建议**：这四类端点上 `consumeBudgetWithWindow(`${userId}:password-verify`, 5, 300)`，失败计数复用 `login_attempts_ip` 的锁定时长；连续失败后要求重新登录（轮换 `securityStamp`）。

---

### P2-9 附件元数据创建不校验 `fileSize` 上限/类型，可造孤行与假大小

**事实**：`src/handlers/attachments.ts:141-152` — `const fileSize = body.fileSize || 0;` 直接进 `attachment.size`，`LIMITS.attachment.maxFileSizeBytes`（`src/config/limits.ts:79-82`）只在真正上传时于 `processAttachmentUpload` 里用（`:64-69`），而 `expectedSize` 又取自这个字段（`:66`）；
**影响**：任意用户可无限创建"元数据存在、blob 不存在"的附件行（无配额、无 GC 清理路径），并让客户端显示任意大小；把 `fileSize` 设为 > 100 MiB 时该附件此后永远无法上传（自伤），设成 `NaN`/`"abc"` 会让 `formatSize` 产出 `NaN Bytes`（`:38-43` 用 `toFixed`）。
**建议**：`fileSize` 必须 `Number.isInteger` 且 `0 < v <= maxFileSize`，否则 400；对"元数据已建但 N 小时未上传"的附件加惰性清理。

---

### P2-10 备份目标端点无协议/网段限制，服务端携凭据向任意 http(s) 地址发请求

**事实**：S3 `endpoint`、WebDAV `baseUrl` 只校验 `^https?://`：`src/services/backup-config.ts:129-133`、`:164-168`；随后 `fetch` 直连（含 `Authorization`/`Basic` 凭据）：`src/services/backup-uploader.ts:266-271`、`:289-294`、`:322-330`、`:527-536`；`redirect` 未显式设置（默认 follow）。
**影响**：管理员可把目标配成内网地址（`http://10.x/…`、`http://127.0.0.1:PORT`）让服务端带着凭据去请求，形成管理面 SSRF 与"凭据发往内网"；若 `fetch` 在跨源重定向时保留 `Authorization`（**待确认**，Workers `fetch` 行为需实测），还可能把 S3 签名/WebDAV 口令重放到第三方。上一轮的 `outbound-guard.ts`（`src/utils/outbound-guard.ts`）已具备主机名/网段判定能力，这里没有复用。
**建议**：备份出站走同一套 `assertOutboundTarget()`；`redirect: 'manual'`；对非 TLS 端点给出显式告警并要求 `allowInsecureHttp=1` 双确认。

---

### P2-11 管理员备份设置读接口明文回显 S3 secret / WebDAV 口令

**事实**：`src/handlers/backup.ts:594-605` 直接把 `loadBackupSettings()` 的结果 `jsonResponse` 出去，未做掩码；写接口同样把新值整体回显（`:646-653`）；凭据字段定义在 `src/services/backup-config.ts:120-152`、`:154-182`。
**影响**：密钥以明文出现在浏览器内存/网络面板/前端日志中；与 P0-1、P1-7 的同源 XSS 组合时，一枚 XSS 即可批量取走备份凭据（进而读走全部历史备份归档）。
**建议**：GET 统一返回 `secretAccessKey: '***'`/`password: '***'` + `hasSecret: true`，PUT 支持"占位符表示不修改"（`normalizeS3Destination` 已有 `allowIncomplete` 分支可复用）。

---

### P2-12 prelogin 通过 KDF 参数暴露"该邮箱是否存在"

**事实**：`src/handlers/identity.ts:729-741` 对不存在的用户回落到默认值（`kdfType 0 / 600000`，`src/config/limits.ts:17-18`），对存在的用户返回其真实 `kdfType/kdfIterations/kdfMemory/kdfParallelism`；注释声称此举"防止用户枚举"（`:731`）。
**影响**：凡使用 Argon2（`kdfType=1`）或自定义迭代数的真实用户，其 KDF 参数与默认值不同 → 直接成为存在性预言机；默认参数的 PBKDF2 用户则与之不可区分（部分缓解）。速率限制也只有 IP 级 `publicRequestsPerMinute`（且受 P1-3 影响）。
**建议**：对**所有**用户返回同一组参数（或至少把 `kdfType/kdfMemory/kdfParallelism` 压平成服务器默认值，并让客户端在登录失败时回落重试），把"是否需要改 KDF"放到认证后接口。

---

## 需要补的测试

1. **备份 round-trip（最高优先）**：构造 `buildBackupArchive()` → `parseBackupArchive()` → `runImportAndAudit()` 的最小用例，断言 users 行数与可登录性；这条测试能直接抓住 P1-2，且现在 `tests/` 下**完全没有 backup 相关用例**（`grep -rl 'backup' tests` 为空）。
2. **zip bomb 与超大 body**：60 MiB 高压缩比归档 + 无 `Content-Length` 的 multipart，断言在**解压前**被拒、且峰值内存有界（P1-5）。
3. **限流跨窗口**：同一 key 连续跨 3 个 60s 窗口各打 `max+1` 次，断言每次都在第 `max+1` 次被拒（P1-3，可直接用 miniflare/D1 本地跑）。
4. **refresh token 家族**：并发两次刷新（宽限期内）+ 宽限期后重放旧 token，断言 ① 宽限期内的并发不吊销家族 ② 宽限期外重放既 401 **又** 使家族内所有 token 失效（P1-4，当前该断言必失败）。
5. **下载响应头契约**：`GET /api/sends/:id/:fileId`、`GET /api/attachments/:cid/:aid` 上传 `Content-Type: text/html` 后断言响应头为 `application/octet-stream` + `Content-Disposition: attachment`，且 CSP 含 `sandbox`（P0-1）。
6. **icon-proxy 类型白名单**：mock 上游返回 `image/svg+xml`，断言响应为固定 `image/png` 或 404；mock 上游返回 10 MiB png，断言被截断/拒绝（P1-7）。
7. **备份设置加密不变式**：`users` 里没有带公钥的 active admin 时，断言 `normalizeImportedBackupSettingsValue()` 抛错而非返回明文 JSON，且 `config` 表中不出现 `secretAccessKey` 明文（P1-6）。
8. **附件元数据校验**：`fileSize = -1 / 0 / 1e12 / "abc" / 缺失` 的四个请求应分别得到 400（P2-9）。
9. **密文上下文绑定**（当前无 AAD，见备注）：两条不同用户的密文互换后应解密失败；现状是通过的（`src/utils/crypto.ts:161-179` 未传 `additionalData`），属于需要先改实现再补测试的项。
10. **cookie 解析健壮性**：`Cookie: tirisfal_web_refresh=%zz` 断言返回 400 而不是 500（`src/handlers/identity.ts:44` 的 `decodeURIComponent` 会抛 URIError，属"待确认"的低危健壮性问题，未单列为发现）。

---

## 备注（审查方法限制）

- 全部结论基于静态阅读 + 本地 `node:sqlite` 语义复现；未启动服务、未构造真实归档、未在浏览器验证 XSS。P0-1 与 P1-7 的浏览器侧行为（CSP 下内联脚本执行、SVG 顶层渲染）属标准行为推断，标注了"判断"。
- 阅读工具对部分标识符做了脱敏替换，行号与语义不受影响；引用处均给出原始行号，可直接对照源码。

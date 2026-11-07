# tirisfal 全仓多维度代码审查报告

> 基线：`main@8693cb6` + 未提交的容器化改动（`docker/` 等）
> 日期：2026-11-08
> 方式：4 名独立审查员（Agent Team：backend / security / frontend / ops，各自只读、独立出报告）+ Lead 横向度量与交叉复核
> 明细报告：[`reports/review/`](../reports/review/)（backend-architecture.md / security-correctness.md / frontend.md / ops-delivery.md）

---

## 一、执行摘要

**总分 2.5 / 5。** 这是一个「骨架正确、局部实现扎实，但机制闭环与工程质量门禁失真」的代码库。

三句话结论：

1. **安全上有 1 条可构成账户接管的 P0**：Send/附件下载把上传时的 MIME 原样回写且无 `Content-Disposition`，配合全站 `script-src 'unsafe-inline'` → 点开链接即同源 XSS。
2. **多条防护「写了但不可达」**：固定窗口限流换窗即失效、refresh token 家族撤销条件恒假、备份恢复撞 NOT NULL、`/health` 被静态资源吞掉 —— 都属于「机制存在、路径不通」，比没写更危险，因为它骗过了评审。
3. **优雅度不是风格问题而是结构问题**：19 个文件 >400 行、18 个函数 >100 行、43 个函数圈复杂度 ≥15、handler 层 128 处直连 `env.DB` 绕过仓储、405 个 `errorResponse` 的具体文案全部被统一文案替换。

---

## 二、多维度评分

| 维度 | 分数 | 主要依据 |
|---|---|---|
| 安全（认证/会话/备份/附件/注入） | **2.0** | 1×P0 + 5×P1；越权与 SQL 注入面干净（4/5），备份与下载面失守（2/5） |
| 后端架构 | **2.5** | 分层方向对，但仓储靠 44 处 `.bind(this)` 回调倒注；StorageService 89 方法门面 |
| 后端代码优雅度 | **2.5** | 重复 40 处请求样板、6 份批量 SQL、3 份 token 响应、4 份 notify；`: any` 54 处 |
| 前端一致性/可维护性 | **2.8** | 工程骨架优于平均（API 层、i18n、对话框原语），但页面级巨组件 + 顶层单点状态 + 零无障碍 |
| 测试质量 | **2.0** | 102 例、语句覆盖 **9.63%**、57/68 文件 0 覆盖；门禁阈值只有 2.5% |
| 交付/运维 | **2.5** | 容器化安全基线到位，但 tunnel 网络断、示例密钥护栏失效、CI 无 e2e/无 compose 校验 |
| 文档 | **3.0** | DOCKER.md/OPERATIONS.md 质量好；三份文档口径未打通，命令未逐条验证 |

---

## 三、跨维度根因（比单条 bug 更重要）

### 根因 A：机制存在 ≠ 机制生效（「不可达的防线」）

| 机制 | 为什么不可达 | 证据 |
|---|---|---|
| 固定窗口限流 | UPSERT 带 `WHERE window_start = excluded.window_start`，换窗后行不更新，新窗查询取不到 → 永远 `allowed` | `src/services/ratelimit.ts:202-216`（审查员用 `node:sqlite` 复现：count 停在 5、新窗 0 行） |
| refresh token 家族撤销 | 轮换先把旧 token 过期压到 `now+60s`，检测要求 `now-rotatedAt>60s`；而过期行会被直接删除 → 条件恒假 | `identity.ts:658-665` + `auth.ts:279-287` + `storage-refresh-token-repo.ts:103-106` |
| 备份恢复 | 导出删除 `master_…_hash`，导入列白名单仍包含它，而列是 `NOT NULL` → 影子表插入必失败 | `backup-archive.ts:130-148`、`backup-import.ts:683`、`migrations/0001_init.sql:23` |
| `GET /health` | `isWorkerHandledPath` 白名单不含 `/health` → 被 SPA 回退吞成 200 + index.html，监控假绿 | `src/index.ts:27-36`、`wrangler.toml:5-9` |
| CI 镜像扫描 | 判根目录 `Dockerfile` 恒为不存在 → Trivy 步骤永不执行 | `.github/workflows/security.yml:88-104` |
| v3 密文覆盖面 | 读取时透明升级依赖「有人读」；从未被读的旧密文永远停在 PBKDF2-100k | `sm-service.ts:decryptAndUpgradeSecretValue` |

**共同点**：都缺少「这条防线到底走没走过」的执行级测试。102 个用例覆盖的是工具函数与 handler 的 normal path，不是安全不变式。

### 根因 B：抽象只做了一半（拆分产生双轨）

- 仓储层拆出来了，但 handler 仍 128 处直连 `env.DB`，`import.ts` 还手写全字段 `INSERT`，与 `storage-cipher-repo.saveCipher` 双份维护（`import.ts:290-300`）。
- 仓储反过来依赖宿主注入 `bind(this)` 的 3 个工具函数（44 处），等于「拆了但没解耦」。
- 两套 schema 定义（`storage-schema.ts` 15 张表 vs `migrations/0001`+`0002` 21 张）需要人工同步。
- `StorageService` 同时是仓储聚合 + 建表 + 定时清理，89 个平铺方法。

### 根因 C：质量门禁的阈值与真实质量脱钩

- 覆盖率门禁 2.5%（`package.json:27`），实测 9.63% 却能过；57/68 文件 0 覆盖。
- `errorResponse` 在 405 个调用点传入具体文案，但 `response.ts:156-171` 按状态码无条件替换为「请求无效/禁止访问/未找到」，**0 个调用点**用 `exposeInternals` → 所有字段级错误提示是死代码，前端只能显示笼统错误。
- 安全门禁只覆盖三类（IDOR SQL / 动态 SQL / 公开路由限流），对「响应头」「限流语义」「备份 round-trip」无感知。

---

## 四、P0（阻断级，建议立即处理）

| # | 问题 | 证据 | 状态 |
|---|---|---|---|
| P0-1 | **Send/附件下载 = 同源 XSS → 账户接管**：上传 MIME 客户端可控（`direct-upload.ts:120-123`），下载原样回写且无 `Content-Disposition`（`sends-public.ts:305-311`、`attachments.ts:405-411`），路由公开无限流（`router-public.ts:219-222`），全站 CSP 含 `script-src 'unsafe-inline'`（`response.ts:119`） | 已复核代码，成立 | **待修** |
| P0-2 | **CF Tunnel 开箱不通**：`edge` 网络 `internal: true`，cloudflared 只挂 `edge` → 无外网出口 | `docker/compose.yaml` | ✅ **本轮已修**（新增 egress 网络） |
| P0-3 | **示例密钥护栏失效**：entrypoint 只拒根示例值，容器示例是另一串；`ENCRYPTION_KEY` 无强度校验 → 照 quickstart 走会以公开示例密钥启动 | `docker-entrypoint.sh:30`、`secrets/dev.vars.example` | ✅ **本轮已修**（改 `REPLACE_ME` 占位 + 双密钥长度校验） |

> P0-1 的修法（三选一或组合）：① 下载响应固定 `application/octet-stream` + `Content-Disposition: attachment`；② 该响应追加 `Content-Security-Policy: sandbox`；③ 去掉 `script-src 'unsafe-inline'`（webapp 改 nonce/hash）。建议 ①+② 先止血，③ 排期做。

---

## 五、P1（按领域）

### 安全 / 正确性

1. **备份恢复必失败**（NOT NULL）——「备份等于不可恢复」，优先级等同 P0 的数据面。
2. **限流换窗失效**（见根因 A）——注册/刷新/公开接口配额名存实亡。
3. **refresh 重用检测不可达**（见根因 A）。
4. **备份导入 zip bomb**：解压先于大小校验，且 `/api/admin/backup/import` 豁免 body 上限（`router.ts:55-60`）。
5. **无管理员公钥时备份凭据明文落库**（`backup-config.ts:507-534`）。
6. **icon-proxy 透传 SVG + 无限流无体积上限**（`icon-proxy.ts:104-124`，上游行为待确认）。

### 后端架构 / 优雅度

7. **多步写无原子性**：软删除逐条 `.run()`；`saveCipher`→`updateRevisionDate`→`notify` 三条独立语句（`ciphers.ts:548-550`），失败时 revision 不推进 → sync 长期命中旧缓存。
8. **安全基元重复**：`constantTimeEquals` 两份（`identity.ts:49-66` / `auth.ts:168-185`）、`isAdmin` 两份 + 14 处手写 `if (!isAdmin)`。
9. **`handleToken` 505 行**（4 种 grant + 2FA + 设备 + 3 份 token 响应构造），任何认证改动回归面覆盖全部登录路径。
10. **`errorResponse` 吞文案**（405 处）——见根因 C。

### 前端

11. **首屏全量预加载业务包**：`manualChunks` 把所有页面并成 474KB `app-suite` 并 `fetchpriority=high`，`lazy()` 形同虚设。
12. **顶层状态单点**：`App.tsx:1430` 每渲染新建 130 字段字面量，全仓仅 1 处 `memo` → TOTP 逐字符输入重渲 1254 行 `VaultPage`。
13. **26 个 CSS 变量未定义**（`modern.css` 未被引入但组件在用 `--text-muted/--bg-secondary/--brand`）→ 实际视觉缺陷。
14. **换语言 = 重输主密码**（`location.reload()` + 密钥不落盘 → 刷新回 locked）。
15. **无障碍 1.5/5**：0 个 `htmlFor`（128 个 input）、0 个 `aria-live`/`role="alert"`。

### 交付 / 运维

16. **`/__scheduled` 经 Caddy 可从公网触发**（`--test-scheduled` + 全路径反代）→ ✅ **本轮已修**（Caddy 阻断 `/__*`）。
17. **CI 不验证 Caddyfile/compose/二次启动幂等**；e2e 脚本 `stamp` 未定义必崩且不在 CI。
18. **覆盖率门禁形同虚设**（2.5% 阈值 vs 9.63% 实测）。
19. **可观测性缺口**：无 metrics/tracing；`/api/health` 版本硬编码 `'1.0'`；R2 只在 `detailed=true` 才检查。

---

## 六、代码优雅度专项（你特别提到的维度）

| 指标 | 实测 | 判断 |
|---|---|---|
| 文件体量 | 19 个文件 >400 行；最大 `App.tsx` 1726、`VaultPage` 1254、`backup.ts` 1202、`ciphers.ts` 1097 | 需要按职责拆，不是按行数机械切 |
| 函数体量 | 18 个函数 >100 行；`handleToken` 505、`executeConfiguredBackup` 238、`handleRegister` 171 | 巨函数集中在「协议入口」与「编排」 |
| 圈复杂度 | 43 个函数 ≥15 | 与巨函数高度重合 |
| 类型严格度 | `: any` 54 处；`Cipher` 带 `[key: string]: any` 索引签名 | 该索引签名等于对核心模型关闭类型检查 |
| 分层一致性 | handler 直连 `env.DB` 128 处；6 处 handler 手写 SQL | 双轨写入路径是最大的长期债 |
| 重复 | 请求样板 40 处、批量 SQL 6 份、token 响应 3 份、notify 4 份、前端 21 处重复 catch | 可用「抽一次、用多处」收敛 |
| 命名 | repo 的 `findStoredX/saveStoredX` 体系一致；但 camelCase/PascalCase 双写（`ciphers.ts`） | 信息量被别名稀释 |
| 注释 | CONTRACT 注释质量高；但 `response.ts:152-155` 注释与实现不符 | 注释漂移比没注释更危险 |

**结论**：优雅度的主要扣分不在「写得丑」，而在**边界没有被强制**（谁都能写 SQL、谁都能拼错误文案、谁都能定义 schema）。对应的改进不是格式化，而是 3 条硬边界：仓储单入口、响应契约单入口、schema 单来源。

---

## 七、修复路线图（按投入产出排序）

### S1 安全止血（1–2 天）
1. 下载响应固定 octet-stream + `Content-Disposition: attachment` + `CSP: sandbox`。
2. 备份导出/导入字段集一致化，CI 加一条真实 round-trip（临时 D1 → 导出 → 导入 → 查询）。
3. 限流 UPSERT 改成 `CASE WHEN` 同语句换窗重置，补跨窗口回归。
4. refresh 轮换与重用检测的时序重排（先标记 rotated、过期压缩放到检测之后）。
5. 备份导入：先校验解压后总大小/条目数，再解压；恢复 body 上限。

### S2 正确性闭环（3–5 天）
6. `/health` 进 worker 白名单；health 版本读 `APP_VERSION`；补 R2 探测。
7. icon-proxy：拒绝 `image/svg+xml` 或强制 `Content-Disposition`；加限流与体积上限。
8. 无公钥时禁止保存备份目的地（fail-closed），不再明文降级。
9. `errorResponse` 4xx 透出文案、5xx 统一兜底；补契约测试。

### S3 结构收敛（1–2 周，可分批）
10. 仓储单入口：handler 停写 SQL，import 复用 bulk upsert；仓储去掉 `bind(this)` 注入（工具函数下沉）。
11. `handleToken` 拆 4 个 grant + 单一 `buildTokenResponse`。
12. 安全基元单点化（`secure-compare`/`isAdmin` 前置守卫）。
13. 写操作批量化（`db.batch`）+ 永久删除改「先删行、后清 blob」。

### S4 前端与门禁（1–2 周）
14. 前端分包（页面级 chunk）+ 去掉 `fetchpriority=high`；`memo`/`useMemo` 收敛根状态。
15. CSS 变量归并（`modern.css` 退场）+ 死代码清理（`Modern*` 873 行、`/help` 路由）。
16. 无障碍基线：label 包裹式 + `aria-live`/`role=alert` + `eslint-plugin-jsx-a11y`。
17. i18n 响应式（去 reload）+ 错误文案进字典。
18. 门禁升级：覆盖率阈值按模块设（handlers ≥40%、services ≥40%、utils ≥70%），低于阈值即失败；CI 加 compose/Caddyfile 校验与二次启动幂等。

---

## 八、本轮已修的 4 项（随审查一起落地）

| 项 | 修法 | 验证 |
|---|---|---|
| compose tunnel 断网 | 新增 `egress` 网络，cloudflared 双挂 `edge`+`egress` | `docker compose config` 通过 |
| 示例密钥护栏失效 | 示例改 `REPLACE_ME_*`；entrypoint 拒绝占位符 + 校验 `JWT_SECRET≥32`、`ENCRYPTION_KEY≥16` | `sh -n` + 代码走查 |
| `/__scheduled` 可被公网触发 | Caddy 两个 site 均 `respond 404` 拦截 `/__*` | `caddy validate` = Valid |
| 备份命令缺目录 | entrypoint 建 `/data/backups`；文档命令加 `mkdir -p` | 代码走查 |

---

## 八点五、S1 修复记录（2026-11-08 已落地）

| # | 修复 | 代码 | 回归用例 |
|---|---|---|---|
| 1 | 附件/Send 下载强制 `octet-stream` + `Content-Disposition: attachment` + `CSP: sandbox`，杜绝同源内联 XSS | 新增 `src/utils/file-download.ts`，`attachments.ts` / `sends-public.ts` 改用它 | `tests/utils/file-download.test.ts` |
| 2 | 备份导出不再剥离 `master_…_hash`（否则恢复必撞 NOT NULL）；导入前显式校验必需列，错误可读 | `backup-archive.ts` / `backup-import.ts` | `tests/services/backup-fields.test.ts` |
| 3 | 固定窗口限流换窗重置（`CASE WHEN` 同语句完成），不再依赖 `DO UPDATE ... WHERE` | `ratelimit.ts` 导出 `RATE_LIMIT_UPSERT_SQL` | `tests/services/ratelimit-window.test.ts`（真实 sqlite 语义） |
| 4 | 已轮换 refresh token 保留 7 天（而非压到 60s 过期），重用检测可达；判定逻辑抽成纯函数 | `limits.ts`、`identity.ts`、`auth.ts` | `tests/services/auth-refresh-reuse.test.ts` |
| 5 | 备份解压前按条目数/单条/累计体积限额（zip bomb），并给 import 路由加归档体积上限 | `backup-archive.ts`（fflate `filter`）、`router.ts`、`limits.ts` | `tests/services/backup-zipbomb.test.ts`（含 40MB 全零真实样本） |

验证：`vitest` **120 passed**（新增 18 条）、`tsc` 0、`eslint` 0、`prettier` 通过、安全门禁新增 0。

**遗留说明**：备份保留 `master_…_hash` 意味着归档文件含口令校验器，归档需按凭据级别保护（已在代码注释与本文档标注）；S1 只做止血，限流改为「固定窗口 + 原子重置」，滑动窗口/令牌桶留待 S3 评估。

## 八点六、S2 修复记录（2026-11-08 已落地）

| # | 修复 | 代码 | 回归用例 |
|---|---|---|---|
| 1 | `GET /health` 进入 worker 受管路径清单（不再被 SPA 回退吞成 200 假绿）；路径清单抽成 `config/paths.ts` 单一来源 | `src/config/paths.ts`（新增）、`src/index.ts` | `tests/handlers/worker-paths.test.ts` |
| 2 | health 版本改为 `APP_VERSION`（原硬编码 `'1.0'`）；对象存储**始终**探测，不再只在 `?detailed=true` 时检查 | `src/handlers/health.ts` | `tests/handlers/health.test.ts`（+2） |
| 3 | `errorResponse` 语义修正：4xx 透出字段级文案，5xx 统一兜底（`exposeInternals` 才放行），激活 405 个调用点的死文案 | `src/utils/response.ts` | `tests/utils/response.test.ts`（5） |
| 4 | icon-proxy 只接受位图（拒 SVG）、体积上限 256KB、`nosniff`，并接入公开读限流 | `src/services/icon-proxy.ts`、`src/router-public.ts` | `tests/services/icon-proxy.test.ts`（4） |
| 5 | 无管理员公钥时，含凭据的备份设置**拒绝落库**（不再明文降级）；导入路径同样 fail-closed | `src/services/backup-config.ts` | `tests/services/backup-settings-guard.test.ts`（4） |

验证：`vitest` **138 passed**（S1+S2 共新增 36 条）、`tsc` 0、`eslint` 0、`prettier` 通过、安全门禁新增 0。

**行为变化提示**：4xx 错误文案现在会透出（这是修复目标）；备份设置在缺少管理员公钥且有凭据时改为报错，前端需能展示该错误。

## 八点七、S3 修复记录（第一批，2026-11-08 已落地）

| # | 修复 | 代码 | 回归用例 |
|---|---|---|---|
| 1 | `constantTimeEquals` 两份实现（identity 的 API key 比对 / auth 的口令哈希比对）收敛为单点 | `src/utils/secure-compare.ts`（新增） | `tests/utils/secure-compare.test.ts`（4） |
| 2 | `isAdmin` 两份实现收敛为单点（admin.ts / backup.ts） | `src/utils/authz.ts`（新增） | `tests/utils/authz.test.ts`（3） |
| 3 | 用户令牌响应三份拷贝（login / refresh / client_credentials）收敛为 `buildUserTokenResponse`，Web 会话/refresh_token/2FA 由显式选项决定 | `src/services/token-response.ts`（新增）、`identity.ts` | `tests/services/token-response.test.ts`（4） |
| 4 | 永久删除附件改为「先删 DB 行、再清 blob」，避免 DB 失败时留下指向已删对象的坏行 | `handlers/ciphers.ts` | 运行时登录/刷新已验；删除顺序靠代码约束（无集成测试） |

运行时验证（本地 workerd）：注册 → 登录（响应含 access_token/refresh_token/Key/AccountKeys/UserDecryptionOptions）→ 用 refresh_token 换新令牌 **REFRESH_OK**，证明统一构造没有丢字段。

验证：`vitest` **149 passed**（S3 新增 11）、`tsc` 0、`eslint` 0 error、`prettier` 通过、安全门禁新增 0。

**S3 第二批（未做，需要更长窗口）**：handler 停写 SQL / import 复用仓储批量 upsert；`handleToken` 505 行按 grant 拆分；写入路径统一 `db.batch` 原子化；`errorResponse` 调用点清理（现已有语义但 405 处仍可精简）。

## 九、度量复现命令

```bash
vitest run --coverage                 # 语句覆盖 9.63%，57/68 文件为 0
eslint src --rule '{"complexity":["warn",15]}'          # 43 个函数
eslint src --rule '{"max-lines-per-function":["warn",100]}'  # 18 个函数
grep -rc 'env\.DB' src/handlers                        # 128 处直连
grep -rc 'errorResponse(' src                            # 405 处，exposeInternals 使用 0 处
```

---

## 十、审查边界

- 未做：运行时压测、真实 D1 数据量下的查询计划、浏览器实测（无障碍与首屏体积需 Lighthouse 复核）、WebAuthn（`utils/passkey.ts` 目前无调用方，属死代码）。
- 标注「待确认」的项：icon-proxy 上游行为、gzip/brotli 后首屏体积、备份导入降级路径的实际触发条件。
- 本报告所有 P0/P1 结论均带 `文件:行号`，其中 P0-1、限流、备份、refresh 四项已由 Lead 二次复核代码；限流一项另由审查员用 `node:sqlite` 语义复现。

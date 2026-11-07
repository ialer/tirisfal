# 运维 / 交付 / 测试 维度审查报告

> 审查人：ops-reviewer（团队多维度代码审查）
> 审查时间：2026-11-08
> 仓库：`/data/开发/tirisfal`，基线 main@8693cb6 + 未提交的容器化改动（21 文件）
> 范围：`docker/`（新增）、`.github/workflows/`、`scripts/`、`docs/`、`tests/`（11 文件）、`package.json`、`wrangler*.toml`、`migrations/`
> 方法：只读代码与只读命令（read/grep/wc/coverage-final.json 解析）；**未**执行 docker build、npm install、vitest。
> 标注约定：**事实**＝代码/文件可直接指认；**判断**＝基于事实的工程推论；**待确认**＝无法在本机只读验证。

---

## 评分

| 维度 | 分数 | 一句话理由 |
|---|---|---|
| 容器化交付 | **3 / 5** | 非 root、read_only、cap_drop、密钥文件挂载、tini、健康检查都在，工程素养明显高于平均；但 tunnel profile 因网络 internal 而不可用、示例密钥护栏对实际示例文件失效、`--test-scheduled` 生产常开。 |
| CI | **2 / 5** | 有 lint/typecheck/test/build/security 五段流水线且 docker.yml 带真实冒烟，但无 e2e、无 Caddyfile/compose 校验、镜像 CVE 扫描因路径判断错误永不触发、无多架构/无 SBOM/无 provenance。 |
| 测试质量 | **2 / 5** | 102 例里安全回归用例写得有针对性（`/use` 脱敏、SSRF、hosts 通配、IP 信任链），但整体语句覆盖 9.6%、57/68 个源文件 0 覆盖，路由层/存储层/定时任务/备份全裸奔，门禁阈值 2.5% 形同虚设。 |
| 文档一致性 | **3 / 5** | `docs/DOCKER.md` 结构完整、排障表实用，是本仓最好的一份文档；但 3 条可直接复制的命令实际会失败，OPERATIONS/SECURITY-CHECKLIST 仍是 Workers 时代的表述且未与容器路径打通。 |
| 可观测性 | **2 / 5** | 有 `/api/health` 与 `secret_access_logs` 审计表，但健康检查版本号是硬编码 `1.0`、R2 只在 `detailed=true` 才检查，全仓无 metrics/tracing/结构化日志/日志轮转。 |
| 升级与回滚 | **2 / 5** | 迁移账本 + flock + 超时 + 表结构复验的思路是对的，但判断依据是"文件个数"而非迁移名/哈希，镜像只有 `local/latest/sha-` 没有版本 tag，`docker compose pull` 对 local tag 无效，卷备份命令本身跑不通。 |
| **综合** | **2.5 / 5** | 容器化是"能跑且跑得干净"，但交付链路的**验证**与**回滚**两段还没闭环；建议按本报告清单补齐后再对外宣布可交付。 |

---

## 发现

共 12 条，按严重度排序。每条给：证据（文件:行号）· 影响 · 建议。

### P0-1 `cloudflared` 挂在不允许外连的 `internal` 网络上，公网隧道 profile 无法工作

- **证据（事实）**：`docker/compose.yaml:79-81` 定义 `networks.edge.internal: true`；`cloudflared` 只接 `edge`（`docker/compose.yaml:71-72`）；文档把它作为公网唯一入口（`docs/DOCKER.md:62-70`，`docs/DOCKER.md:99-101`）。
- **影响**：Docker 的 `internal: true` 网络不提供外部网关，容器无法访问互联网。cloudflared 必须主动拨号到 Cloudflare 边缘（region1/2.argotunnel.com），因此 `--profile tunnel` 启动后必然表现为反复重连失败、隧道不注册、Caddy `:80` 收不到回源。文档主推的"公网只经 Tunnel 暴露"路径**开箱不可用**，且失败信息在 cloudflared 容器日志里，排障容易被误判成 token 问题。
- **建议**：给 `cloudflared` 单独加一条可出网的网络（如 `networks: [edge, egress]`，`egress` 为默认 bridge），`edge` 保持 internal；或在 docker.yml 里补一条 `docker compose --profile proxy --profile tunnel config` + 起容器后 `cloudflared tunnel info` 的连通性断言，让这类"编排层不通"在 CI 就暴露。

### P0-2 示例密钥护栏对真实示例文件失效，quickstart 可能以公开密钥上线

- **证据（事实）**：entrypoint 只拒绝**一个**硬编码值 `Enter-your-JWT-key-here-at-least-32-characters`（`docker/docker-entrypoint.sh:30-32`），该值来自仓库根 `.dev.vars.example:5`；但容器实际使用的示例是 `docker/secrets/dev.vars.example:6-7`，其中 `JWT_SECRET=REPLACE_ME_WITH_openssl_rand_hex_32`（35 字符）、`ENCRYPTION_KEY=REPLACE_ME_WITH_openssl_rand_base64_32`，**不在**拒绝名单、也不含 `REPLACE_ME`，且长度校验只针对 `JWT_SECRET` 且 35 ≥ 32（`docker/docker-entrypoint.sh:34-39`）。
- **影响**：按 `docs/DOCKER.md:24` 的 `cp secrets/dev.vars.example secrets/dev.vars` 走一遍、若操作者漏掉"编辑填真实值"这一步，容器会**正常启动**并宣告 healthy，但 JWT 签名密钥是仓库里公开的字符串——任何读过本仓库的人都能离线签发合法 access token，直接读到用户密码库。护栏存在的意义正是拦截这一步，现在它是死的。另外 `ENCRYPTION_KEY` 完全没有强度/长度校验，而 `docs/OPERATIONS.md:28` 明确写了它不可更换，弱密钥是永久性的。
- **建议**：把护栏从"比对具体值"改为"结构性判定"：`ENCRYPTION_KEY` 必须 base64 解码后 ≥32 字节、`JWT_SECRET` ≥32 字符且字符集随机度达标，并对 `docker/secrets/dev.vars.example` 的两个值同样拒绝；示例文件改成 `REPLACE_ME` 形态（配合现有 REPLACE_ME 检查）比造一个假随机值更安全。CI 里加一条用例：用示例文件起容器，**断言启动失败**。

### P1-1 容器内常开 `--test-scheduled`，`/__scheduled` 可从公网触发定时任务

- **证据（事实）**：`docker/docker-entrypoint.sh:86` 给 `wrangler dev` 传了 `--test-scheduled`；`docker/cron-tick.mjs:9` 依赖该开关调用 `http://127.0.0.1:8787/__scheduled?cron=...`；Caddy 是**整路径**反代（`docker/Caddyfile:12-17`、`docker/Caddyfile:22-25`），不区分路径；定时任务体在 `src/index.ts:121-149`（备份 + 审计清理）。
- **影响**：`/__scheduled` 是 wrangler dev 的测试入口，没有任何鉴权。经 443 或 Tunnel 进来的任意客户端只要 `GET /__scheduled?cron=*/5 * * * *` 就能反复触发 scheduled handler：备份任务虽然靠 lease 去重（`src/handlers/backup.ts:567`），但每次都会走 `ensureDatabaseInitialized` + 审计清理 SQL，构成低成本放大面；同时把"生产容器里存在测试后门路由"写进了架构。
- **建议**：三选一——(a) Caddy 显式拒绝 `/__scheduled`（`respond 404`），cron-tick 走 `edge` 网络内部访问绕过；(b) 生产改为不带 `--test-scheduled`，由外部 scheduler（宿主 cron / ofelia）以 `docker exec` 方式触发；(c) 若必须保留，加 `PROXY_SHARED_SECRET` 同款的内部共享头校验。

### P1-2 CI 不验证编排层：Caddyfile、compose、二次启动/迁移幂等全部无覆盖

- **证据（事实）**：`docker.yml:29-48` 的冒烟只做 `docker run` + `/api/health` + register + token 三件事；`docker.yml:34` 没有 `--read-only`、`--cap-drop`、tmpfs，与生产参数（`docker/compose.yaml:17-23`）不一致；全仓 CI 无 `caddy validate`、无 `docker compose config`、无"同一卷起两次容器"的幂等断言（grep `.github/` 只有 `ci.yml:48` 一处 test:coverage）。历史上 Caddyfile 的 `{$VAR}` 双括号语法就是靠人工实测才抓到的。
- **影响**：本次改动里最容易回归的三处恰好都不在 CI：Caddyfile 语法/变量、compose 的 profile 组合、以及"第二次启动时迁移如何跳过"（entrypoint 的 `applied_count` 分支 `docker/docker-entrypoint.sh:60-68` 只有 `APPLIED < EXPECTED` 分支被跑到）。此外冒烟用的镜像没有启用 read_only/tmpfs，entrypoint 写 `/data` 之外的路径这类缺陷在 CI 里不会暴露。
- **建议**：docker.yml 增加三步：`docker run --rm -v $PWD/docker/Caddyfile:/etc/caddy/Caddyfile caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`；`docker compose -f docker/compose.yaml --profile proxy --profile tunnel config -q`；冒烟改成 `docker compose up -d` 起两次（第二次断言日志出现 `migrations ready` 且无 `applying`），并给 `docker run` 补上与生产一致的 `--read-only --cap-drop ALL --security-opt no-new-privileges`。

### P1-3 镜像安全扫描永远不会执行，且没有镜像 CVE 扫描 / SBOM

- **证据（事实）**：`security.yml:88-95` 的判断是 `if [ -f "Dockerfile" ]`（仓库根），而 Dockerfile 在 `docker/Dockerfile`（`docker.yml:24`），因此 `steps.check_docker.outputs.exists` 恒为 `false`，`security.yml:97-104` 的 Trivy 步骤被跳过；即便触发，跑的也是 `trivy config .`（扫 IaC 配置，不扫镜像），并且 `|| true` 使其不阻断（`security.yml:103`）；`ci.yml:83-84` 只做 `npm audit`，`docker.yml` 只 build/push（`docker.yml:69-82`），无 `trivy image`、无 `--provenance`/`--sbom`。
- **影响（判断）**：镜像里带着完整 `node_modules`（`docker/Dockerfile:26` 整包复制，含 devDependencies 与 wrangler/workerd），攻击面远大于 `npm audit --omit=dev` 覆盖的范围；现在既没有 CVE 扫描，也没有可追溯的构建证明，出事时无法回答"这个镜像里到底是什么"。
- **建议**：`security.yml:91` 改判 `docker/Dockerfile`；docker.yml 的 push job 加 `docker/build-push-action` 的 `provenance: true`、`sbom: true`，并在镜像产出后跑 `trivy image --severity CRITICAL,HIGH --exit-code 1 ghcr.io/...:sha-...`（先允许 HIGH 观察期，CRITICAL 阻断）。

### P1-4 唯一的 e2e 脚本是坏的，且从未进入任何流水线

- **证据（事实）**：`scripts/e2e-smoke.mjs:168,170-171,195-197` 使用变量 `stamp`，但全文件无定义（`grep -n 'stamp'` 只有这 6 处使用点）→ 运行必然 `ReferenceError`；脚本头部要求先跑 `scripts/e2e-provision-local.mjs`（`scripts/e2e-smoke.mjs:8`），该文件在 `scripts/` 下不存在；默认凭据硬编码在 `scripts/e2e-smoke.mjs:16`；`.github/` 下没有任何 workflow 调用它（grep `e2e|smoke` 只命中 `ci.yml:48`）。
- **影响**：容器化的可运行性依据是 2026-11-07 的一次人工实测记录（团队记忆），仓库内没有任何可重复执行的端到端证据——也就是说这次交付的"已验证"状态无法被第三人或下次发版复现。cipher 创建→sync 解密→轮换→删除这条最核心的链路（也正是 e2e-smoke 想覆盖的）现在完全没有自动化回归。
- **建议**：修 `stamp`（`const stamp = Date.now().toString(36)` 之类）并补 `e2e-provision-local.mjs`，或把 provision 逻辑改成容器启动时用 `/api/accounts/register` 现建账号（`docker.yml:41-44` 已有现成写法可复用）；把 `docker compose up -d` + `node scripts/e2e-smoke.mjs` 接进 docker.yml 的冒烟步骤，替换掉现在只有 health/register/token 的三段式。

### P1-5 覆盖率门禁形同虚设，路由/存储/定时任务/备份四条主干零覆盖

- **证据（事实）**：`package.json:27` 的阈值是 `statements=2.5 / branches=25 / functions=10 / lines=2.5`；从 `coverage/coverage-final.json` 统计：68 个源文件中 **57 个**语句命中为 0，整体语句覆盖 **9.6%（2058/21357）**、函数 33.7%；0 覆盖文件包括全部 7 个 `src/router-*.ts`、18 个 `src/services/storage-*-repo.ts`、`src/services/backup*.ts`、`src/services/ratelimit.ts`、`src/durable/notifications-hub.ts`；且 `vitest.config.ts:22` 把 `**/index.ts` 从覆盖率统计里排除，等于 `src/index.ts` 的 `scheduled` handler（`src/index.ts:121`）连"被统计"的资格都没有。
- **影响（判断）**：门禁的语义已经变成"只要别跌到 2.5% 就行"，任何在路由层或存储层引入的回归都不会被拦住。**这正是 1.6.0 修过的 bug 类型**——`docs/OPERATIONS.md:89` 记录"SM 路由早于 JWT 校验"的路由顺序缺陷，而路由层现在 0 覆盖。
- **建议**：把阈值抬到能起作用的水平（先 statements/lines 25%、branches 60%，一个季度内抬到 50/75）；优先补三类测试：router 级（把 `handleRequest` 当入口跑，验证 401/403/404 与路由顺序）、storage repo 级（用 `miniflare` / `@cloudflare/vitest-pool-workers` 跑真 D1，替掉现在 `tests/services/sm-service.test.ts:6-12` 的手写 mockDb）、scheduled handler 级（断言触发时不抛、lease 生效）。

### P1-6 备份 runbook 的第一条命令跑不通，且没有任何恢复演练/自动备份保底

- **证据（事实）**：`docs/DOCKER.md:89` 让用户 `sqlite3 ... ".backup /data/backups/d1-....sqlite"`，但容器内只创建了 `/data/runtime` 与 `/data/state`（`docker/docker-entrypoint.sh:9-17`），`/data/backups` 不存在 → `unable to open database file`；`docs/DOCKER.md:90-91` 的卷级 tar 只打 `state`；`docs/DOCKER.md:94` 的恢复只有一句"停容器 → 覆盖 state"，没有校验步骤；`docker/compose.yaml` 里没有备份 sidecar/定时导出（`docker/cron-tick.mjs` 只驱动应用内 scheduled 备份，而它依赖 R2/S3 目的地配置，属"要先去 UI 里配好"的前置条件，文档未写）。
- **影响**：交付时"备份存在"的直觉是假的——第一条命令就报错，操作者很可能误判为"权限问题"然后改路径重试（`/data` 下可写，所以 `mkdir` 能过），但没人验证过产出的 sqlite 是否 `PRAGMA integrity_check` 通过。这是本仓库唯一的数据面出口，风险与修复成本严重不对称。
- **建议**：entrypoint 里 `mkdir -p "$STATE_DIR/../backups"`；把备份做成脚本 `scripts/backup-volume.sh`（`sqlite3 .backup` → `integrity_check` → gzip → 保留 N 份），文档直接调该脚本；在 `docs/DOCKER.md` 第 7 节补"恢复演练"的可执行序列（临时卷 + 起容器 + 登录 + 读一条凭证 + 断言），并把这条演练写进发布检查清单。

### P2-1 镜像 tag 没有版本语义，`docker compose pull` 升级路径不成立

- **证据（事实）**：`docker/compose.yaml:14` 默认 `TIRISFAL_IMAGE=ghcr.io/ialer/tirisfal:local`，且同文件有 `build:` 段（`docker/compose.yaml:11-13`）；`docker/env.example:9` 也写 `local`；GHCR 只推 `latest` 与 `sha-<sha>`（`docker.yml:75-77`），没有 `v1.6.0` 这类版本 tag；而 `docs/DOCKER.md:99-101` 的升级方式是 `docker compose pull` + 改 `.env` 里的 tag。
- **影响**：`:local` 是本地构建标签，`pull` 会因 registry 无此 tag 而失败或拉到旧缓存；`latest` 可变，回滚到"上一个版本"只能靠人工记住 sha。`docs/DOCKER.md:104` 明确写了"v1.6.0 起密文是 v3，旧镜像读不了"，也就是说**回滚需要精确的版本对应关系**，而现在这套 tag 体系给不出这个关系。
- **建议**：docker.yml push 时按 `package.json` 版本打 `v1.6.0` / `1.6` / `sha-...` 三档，`latest` 保留但文档改成"生产钉版本 tag"；`docker/env.example` 的默认值改成 `ghcr.io/ialer/tirisfal:v1.6.0`，本地构建用 `--build` 覆盖；在 `docs/DOCKER.md` 第 8 节补"回滚 = 改 tag 到上一版本 + 用备份恢复 volume"的成对动作。

### P2-2 健康检查与可观测性不足以支撑排障（无 metrics / tracing / 结构化日志 / 日志轮转）

- **证据（事实）**：`src/handlers/health.ts:23` 的 `version` 硬编码为 `'1.0'`，而 `package.json:3` 是 `1.6.0`；`src/handlers/health.ts:39` 只有 `detailed=true` 才检查 R2，而 Dockerfile 的健康检查是裸 `/api/health`（`docker/Dockerfile:47-48`）→ 存储故障永远不会让容器 unhealthy；`docker/compose.yaml` 无 `logging:` 段（无 `max-size`），`docker/docker-entrypoint.sh:14` 的 `log()` 无时间戳、无级别；全仓无 `/metrics`、无 tracing 接入（grep 无命中）。
- **影响（判断）**：排障只能靠 `docker logs` 里的 wrangler 文本与 DB 里的审计表，两个都不带关联 id；一周后日志可能把 NAS 磁盘写满（默认 json-file 无上限），而"容器 healthy 但上传全 500"这种典型故障无法从健康接口看出来。健康接口返回错误版本号还会让"这容器到底跑的哪版"变成靠猜。
- **建议**：`version` 从构建期注入（`ARG APP_VERSION` + `ENV`，构建参数取 `package.json`）；健康检查改为 `/api/health?detailed=true` 并对 `degraded` 返回非 200（或在 compose 里加独立的 `/api/health?detailed=true` 探针）；compose 补 `logging: driver: json-file, options: {max-size: "10m", max-file: "5"}`；请求日志加 `request_id` 并落到审计表/标准输出，为后续接 Loki 留出口。

### P2-3 entrypoint 的健壮性：迁移判定按"文件个数"、错误被 `|| true` 吞掉、信号处理有竞态

- **证据（事实）**：`docker/docker-entrypoint.sh:52` 用 `ls /app/migrations/*.sql | wc -l` 作为期望值，`docker/docker-entrypoint.sh:54-58` 用 `ls "$STATE_DIR"/v3/d1/*/*.sqlite | head -n 1` 猜数据库文件，`docker/docker-entrypoint.sh:61-65` 的迁移调用带 `|| true` 且 `timeout 240` 后不保留 wrangler 输出；`docker/docker-entrypoint.sh:91` 的 `trap` 在拉起两个子进程（第 77、82-89 行）**之后**才安装，`wait`（第 92 行）不等待 cron-tick；`docker/compose.yaml` 无 `stop_grace_period`（默认 10s）。
- **影响**：三个具体后果——(1) 迁移是"按数量"判定，若原地修改已应用的 `0007_reveal_policy.sql`（加一列而不新增文件），数量不变 → entrypoint 直接跳过，运行期 SQL 报 `no such column`；(2) 迁移失败时只有一行 `migrations incomplete: N/M`，wrangler 的真实报错（锁冲突/语法错）连同 `timeout` 一起消失，只能重跑碰运气；(3) 启动阶段（迁移最长 240s）收到 `SIGTERM` 时 trap 尚未安装，迁移子进程被孤儿化，容器在 10s 后被 SIGKILL 打断 DDL。
- **建议**：迁移判定改成"账本里的 name 集合 vs `ls migrations` 的 name 集合"（不复用数量）；迁移调用改为 `wrangler ... 2>&1 | tee "$RUNTIME_DIR/migrate.log"` 并保留到失败信息里；trap 提前到第一个子进程拉起之前安装，且 `trap` 里 `kill -TERM` 后 `wait` 两个 PID；compose 补 `stop_grace_period: 30s`。

### P2-4 文档之间口径不一致，且有 3 条"复制即失败"的命令

- **证据（事实）**：
  1. `docs/DOCKER.md:34` 让用户在宿主机 `curl http://127.0.0.1:8787/api/health`，但 worker 端口只在容器网络内 `expose`（`docker/compose.yaml:35-36`），宿主机不可达（同一行括号里虽提了"需进容器"，但命令本身没改成 `docker compose exec`）；
  2. `docs/DOCKER.md:37-38` 称"迁移失败容器不会变为 healthy，**也不会接收流量**"，但 `caddy` 的 `depends_on` 没有健康条件（`docker/compose.yaml:44-45`），caddy 会先起并返回 502——"不接收流量"是错的；
  3. `docs/OPERATIONS.md:30` 的密钥方式是 `wrangler secret put`（Workers 路径），与 `docs/DOCKER.md:40-47` 的"只走文件挂载、绝不走 environment"是两套模型，两份文档互不引用，运维不知道自托管该看哪份；
  4. `SECURITY-CHECKLIST.md:1-4` 的复核日期是 2026-11-06（容器化改动在 11-07 之后），正文几乎全是未勾选的 `[ ]`（如 `SECURITY-CHECKLIST.md:55-56` HTTPS/API 校验），且没有一条容器相关项（镜像扫描、密钥挂载、read_only、/__scheduled），清单已与现状脱节。
- **影响（判断）**：文档是本次交付的主要"产品面"。命令跑不通会让操作者怀疑环境而不是文档，进而做出更危险的动作（比如改成 `ports: 8787:8787` 直接把 worker 暴露到宿主机，绕过 Caddy 的 IP 注入）；两套密钥模型并存则容易让人把密钥写进 `environment:`，`docs/DOCKER.md:46` 警告的 `docker inspect` 泄露就真的发生了。
- **建议**：`docs/DOCKER.md:34` 改成 `docker compose exec tirisfal curl -fsS http://127.0.0.1:8787/api/health`；`docs/DOCKER.md:37-38` 改成"容器不会 healthy，Caddy 会返回 502 直到迁移完成"；给 `caddy` 补 `depends_on: {tirisfal: {condition: service_healthy}}`；在 `docs/OPERATIONS.md` 开头加一句"自托管容器请看 DOCKER.md，本文只覆盖 Workers 部署"；`SECURITY-CHECKLIST.md` 增加"容器部署"小节并把已实现的项打勾（read_only/cap_drop/非 root/密钥文件挂载/健康检查）。

---

## 发布前检查清单（可执行项）

按"必须先做"→"应当做"排序，每条都可直接执行或直接判定通过/不通过。

**阻断项（不通过则不发版）**

1. `docker compose --profile proxy --profile tunnel up -d` 后 60s 内 `docker logs tirisfal-tunnel` 出现 `Registered tunnel connection`（验证 P0-1 已修）。
2. 用 `docker/secrets/dev.vars.example` 原样作为密钥启动 → 容器必须**退出**并打印明确的错误（验证 P0-2 已修）。
3. 从公网侧 `curl -i https://<host>/__scheduled` → 必须 404/403，不得 200（验证 P1-1 已处置）。
4. 同一数据卷连续启动两次容器：第二次日志出现 `migrations ready (7/7)` 且**不出现** `applying D1 migrations`（验证跳过分支）。
5. `caddy validate --config docker/Caddyfile --adapter caddyfile` 通过；`docker compose -f docker/compose.yaml --profile proxy --profile tunnel config -q` 通过。
6. 备份脚本实跑一次，产物 `PRAGMA integrity_check` 返回 `ok`，并按 `docs/DOCKER.md` 第 7 节完成一次"临时卷恢复 + 登录 + 读一条凭证"的演练。
7. `docker stats` 观察 30 分钟：容器无 OOM、`restart` 计数为 0；`docker exec tirisfal sh -c 'ls -l /data/state/v3/d1/*/*.sqlite'` 只有一个 DB 文件。

**应当做（发版后一周内）**

8. 镜像 `trivy image --severity CRITICAL --exit-code 1` 干净；GHCR 上能看到 `provenance` 与 `sbom`。
9. GHCR 存在 `v1.6.x` 版本 tag，且 `TIRISFAL_IMAGE` 指向该 tag（不用 `:local` / `:latest`）。
10. 覆盖率流水线：statements ≥ 25%、branches ≥ 60%，且 `src/router-*.ts` 不再全部为 0。
11. `scripts/e2e-smoke.mjs` 能在 `docker compose up -d` 后一次跑通（全部 PASS），并已接入 docker.yml。
12. `/api/health` 返回的 `version` 等于 `package.json` 版本；`/api/health?detailed=true` 在 R2 不可用时返回非 200。
13. compose 已配置 `logging.options.max-size` 与 `stop_grace_period`；`docker stop` 到容器退出的耗时 < 15s 且退出码为 0。
14. `docs/DOCKER.md` / `docs/OPERATIONS.md` / `SECURITY-CHECKLIST.md` 之间的模型差异已显式声明（自托管 vs Workers），清单中容器项已勾选。
15. `git status` 确认 `docker/`、`.dockerignore`、`docker.yml`、`docs/DOCKER.md` 已入库——**当前这 4 项均为未跟踪状态，CI 尚未在任何提交上验证过本次改动**（事实：审查时 `git status` 显示 `?? docker/`、`?? .dockerignore`、`?? .github/workflows/docker.yml`、`?? docs/DOCKER.md`）。

---

## 附：本次审查的"没做什么"

- 未运行 `docker build` / `npm install` / `vitest`（按任务约束），因此**容器实际可运行性未在本机复测**，P0-1 的结论基于 Docker `internal` 网络语义 + compose 拓扑推理（判断），建议按清单第 1 条实测确认。
- 覆盖率数字来自仓库内已生成的 `coverage/coverage-final.json`（未跟踪文件，生成时间晚于 `tests/utils/client-ip.test.ts` 的加入），非本次重跑结果。
- `src/` 内部实现细节（路由顺序、审计写入正确性）属其他维度审查员范围，本报告只在需要支撑运维结论处引用。

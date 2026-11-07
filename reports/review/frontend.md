# 前端代码审查报告 · webapp/

- 审查范围：`webapp/`（96 个文件 / 31,129 行；`src` 下 TS/TSX 95 文件）
- 审查方式：只读静态审阅 + 只读命令（rg / 文件读取 / 产物目录核对），未执行构建与测试
- 基线：`main@8693cb6`，工作区含未提交的容器化改动（`docker/`、`webapp/index.html` 等），本报告以前者代码为准
- 标注约定：**【事实】** 可直接复现的观测；**【判断】** 审查者推断；**【待确认】** 需运行时/更多上下文验证

---

## 评分

| 维度 | 分数 | 一句话理由 |
|---|---|---|
| 组件粒度 | 2.5 | `VaultPage` 1,254 行 / 29 个 useState / 19 个 useEffect，页面内既管列表虚拟化又管表单、SSH 密钥、附件队列与 12 个对话框状态，单个组件承担了本应拆成 3–4 层的职责。 |
| 复用 | 3.0 | `lib/api/shared.ts` 的 `parseJson`/`createApiError`/`uploadWithProgress` 抽象干净，`ConfirmDialog`+`useDialogLifecycle` 统一了对话框焦点与 body 锁；但错误处理、解耦的类型边界与 i18n 文案三处仍是复制粘贴。 |
| 命名 | 3.0 | `components/vault/`、`components/backup-center/` 子目录命名一致、文件即组件；减分项是 `vault-page-helpers.tsx`（441 行，常量+图标组件+纯函数混杂）与 `Modern*` 三个死文件占位命名。 |
| 状态复杂度 | 2.5 | 全局状态单点堆在 `App.tsx`（18 useState + 31 useEffect + 8 个 ref 做去重/序列号），再以字面量对象下传；页面级 loading/error 三态各写各的（`props.error` 渲染位置 3 种写法）。 |
| 样式一致性 | 3.0 | `styles/tokens.css` + `dark.css` 的双主题变量体系是好的，`color-mix()` 统一派生色；但有 26 个被引用的 CSS 变量从未（或只在未引入的 `modern.css` 里）定义，Tailwind 只当摆设。 |
| 可访问性 | 1.5 | 128 个 `<input>` 对应 0 个 `htmlFor`、0 个 `role="alert"`、0 个 `aria-live`，读屏用户既听不到表单标签也听不到任何错误提示。 |
| **综合** | **2.8** | 工程骨架（构建分包、i18n 分层、API 层、对话框原语）明显优于平均水准，但「页面级巨组件 + 顶层单点状态 + 零无障碍」三件套拉低了优雅度。 |

---

## 发现

> 共 12 条（P0：0 / P1：7 / P2：5）。**未发现 P0 级阻断或数据风险缺陷**：无 `dangerouslySetInnerHTML`/`eval`/`innerHTML`（全仓 0 命中），无第三方资源引用（`webapp/index.html` CSP `default-src 'self'`），加密均在 worker 或 `lib/crypto` 收口。

### P1-1 首屏把「所有业务页」当成一个 474 KB chunk 全量预加载，登录页也不放过

- **证据（事实）**
  - `webapp/vite.config.ts:126-152`：`manualChunks` 把 `VaultPage`、`ImportPage`、所有 `lib/import-*`、`SendPage`、`TotpCodePage`、`BackupCenterPage`、`SettingsPage`、`AdminPage` 全部强制并入单一 `app-suite` chunk。
  - `webapp/vite.config.ts:45-79`（`resourcePriorityPlugin`）：把 `app-suite` 的 `modulepreload` 提到 `fetchpriority="high"`。
  - 产物实测：`dist/assets/app-suite-CCgrxwxW.js` **474,210 B**、`dist/assets/index-B9XoUEqf.js` **185,460 B**、`dist/assets/index-CPjWJDvP.css` **130,986 B**；`dist/index.html` 尾部同时输出 `modulepreload fetchpriority="high" app-suite`。
- **影响（判断）**：`AppMainRoutes.tsx:15-24` 已经用了 `lazy()`，等于白做——所有懒加载页被打进同一个 chunk 并在首屏就 `high` 预加载，登录/锁屏页照样下载全部业务代码。首屏 JS 无压缩口径约 659 KB，移动端与内网反代首包感知明显。**【待确认】** 实际 gzip/brotli 后体积（本次未构建，不能假设 CDN 一定开启压缩）。
- **建议（最小改动）**：`manualChunks` 里只保留真正共享的 `lib/import-*`+`export-formats`（改名 `import-suite`），其余按页面各成一个 chunk；`resourcePriorityPlugin` 不再给 `app-suite` 提优先级，只有登录后首路由（vault）才预取。

### P1-2 `App` 顶层状态一变就重渲整棵页面树，全仓只有 1 处 `memo`

- **证据（事实）**
  - `webapp/src/App.tsx:1430` `const mainRoutesProps = { … }` 是每次渲染新建的对象字面量（约 130 个字段），`App.tsx:1670-1686` 原样传给 `AppAuthenticatedShell` → `mainRoutesProps={effectiveMainRoutesProps}`。
  - `webapp/src/components/AppAuthenticatedShell.tsx:48`、`webapp/src/components/AppMainRoutes.tsx:144` 均为普通函数组件，无 `memo`。
  - 全仓 `memo(` 命中 1 处：`webapp/src/components/vault/VaultListPanel.tsx:77`（`CipherListItem`）。
  - 会触发 `App` 重渲的高频源：`App.tsx:199` `totpCode`（逐字符输入）、`App.tsx:215` `mobileSidebarToggleKey`、`useToastManager` 的 4.5s 定时移除（`webapp/src/hooks/useToastManager.ts:12-16`）。
- **影响（判断）**：在 TOTP 输入框敲 6 位数字 = `VaultPage`（1,254 行）整棵树 diff 6 次；`mainRoutesProps` 每次都是新引用，子组件内任何以 props 为依赖的 `useMemo/useEffect` 都可能被连带重算。这属于可测量的交互卡顿来源，而非理论洁癖。
- **建议**：① 给 `AppAuthenticatedShell` 与 `AppMainRoutes` 加 `memo`；② `mainRoutesProps` 用 `useMemo` 包裹并显式列出依赖；③ TOTP/确认框这类瞬时状态收敛到 `AppGlobalOverlays` 内部（受控 props 改为内部 state + 回调），不让它污染根组件。

### P1-3 26 个被引用的 CSS 变量从未定义，其中 `--text-muted`/`--bg-secondary`/`--brand` 已在生产组件里使用

- **证据（事实）**
  - 定义处只在未引入的样式表：`webapp/src/styles/modern.css:2-20` 重新声明了 `:root { --primary: #3b82f6; --text-muted: …; --bg: …; --surface: … }`；而 `webapp/src/styles.css:1-13` 的 `@import` 列表**没有包含 `modern.css`**（也没有 `base/forms/dark` 之外的 modern 相关引用）。`rg 'modern.css'` 在 `webapp/src` 内 0 命中。
  - 实际使用（生产代码，非死文件）：
    - `webapp/src/components/SecretsManagerPage.tsx:243,268,276,315,372`：`style={{ color: 'var(--text-muted)' }}`
    - `webapp/src/components/SecretsManagerPage.tsx:550`：`background: 'var(--bg-secondary)'`
    - `webapp/src/styles/vault.css:79` `color: var(--brand)`、`webapp/src/styles/vault.css:195` `color: var(--text-muted)`
  - 全量比对：`tokens.css` 定义 35 个变量，`webapp/src` 共引用 60 个，**26 个未定义**（`--brand`、`--text-muted`、`--surface`、`--border`、`--bg`、`--primary-light`、`--primary-dark`、`--shadow-glow`、`--radius-full`、`--space-*` 等）。
- **影响（判断）**：`var()` 解析失败时属性按 invalid-at-computed-value-time 处理 → 颜色继承父级，图标/次要文字在浅色与暗色主题下对比度都不可控（尤其 SecretsManagerPage 的空状态大图标会变成普通文本色）。这是**实际视觉缺陷**，不是代码风味问题。
- **建议**：把 `modern.css` 里仍在使用的 3 个变量（`--text-muted`、`--bg-secondary`、`--brand`）改名并入 `tokens.css` 的 `--muted`/`--panel-muted`/`--primary`；`modern.css` 整文件删除（见 P2-1）。顺手加一条 lint：`rg 'var\(--' ` 的键必须存在于 `tokens.css`。

### P1-4 切换界面语言整页 reload，导致必须重新输入主密码

- **证据（事实）**
  - `webapp/src/components/SettingsPage.tsx:172-176`：`await setLocale(next); window.location.reload();`
  - `webapp/src/lib/api/auth.ts:112-126` `saveSession` 只持久化 `{email, authMode}`（`PersistedSessionState`），主密钥/对称密钥不落盘。
  - `webapp/src/lib/app-auth.ts:166-177`：有 session 但无密钥 → `phase: 'locked'`。
- **影响（判断）**：用户在设置里把语言从中文切到英文，页面刷新后落回「锁定」态，必须重输主密码才能继续。对一个密码管理器的主密码输入频率，这是个可感知的体验倒退；也解释了 `i18n.ts` 为什么不敢做响应式 `t()`。
- **建议**：给 `i18n` 加一个极小的订阅（`useSyncExternalStore` 或 `Preact` 的 signal 式 `localeVersion`），`t()` 读模块级 `activeMessages`、组件订阅版本号 → 语言切换仅重渲，不 reload；`window.location.reload()` 只保留给「locale 资源加载失败」的兜底。

### P1-5 无障碍：没有 `aria-live` / `role="alert"`，所有 toast 与页面级错误对读屏用户静默

- **证据（事实）**
  - `rg 'role="alert"' webapp/src` → **0 命中**；`rg 'aria-live' webapp/src` → **0 命中**。
  - `webapp/src/components/ToastHost.tsx:11` `<ul className="toast-stack">` —— 列表容器无 `aria-live`/`role="status"`，`ToastHost.tsx:15` 关闭按钮内容是裸文本 `x`，无 `aria-label`。
  - 页面级错误另起炉灶：`webapp/src/components/SecurityDevicePage.tsx:95-97`、`webapp/src/components/AdminPage.tsx:54-56`、`webapp/src/components/DomainRulePage.tsx:375`（`<div className="status-error">`）。
- **影响（判断）**：所有操作结果（复制成功、删除失败、导出失败）只以视觉反馈呈现；键盘+读屏用户拿不到「已保存 / 失败原因」。对安全产品而言，失败静默 = 用户以为删掉了。
- **建议**：`ToastHost` 的 `<ul>` 加 `role="status" aria-live="polite"`（错误类 toast 走 `assertive` 的独立节点）；抽一个 `<InlineError>` 原语内置 `role="alert"`，替换上述 3 处手写 `div`。

### P1-6 无障碍：表单控件与 label 无程序关联（`htmlFor` 全仓 0 个，`<input>` 128 个）

- **证据（事实）**
  - `rg -c 'htmlFor' webapp/src --glob '*.tsx'` → **0**；`rg -c '<input' webapp/src --glob '*.tsx'` → **128**。
  - 典型写法（label 与 input 是兄弟节点、无 `id`/`for`）：`webapp/src/components/TirisfalLogin.tsx:161-176`、`TirisfalLogin.tsx:261-263`；`webapp/src/components/SettingsPage.tsx:183,197,213` 用 `<label className="field">` 包住 `<select>`（隐式关联可用），但同文件内不统一。
- **影响（判断）**：屏幕阅读器把登录/解锁表单读成「编辑框」而不是「邮箱 / 主密码」；自动填充与「点击标签聚焦」也失效（`TirisfalLogin.tsx:174` 的 label 点不动输入框）。这是**多语言下更严重**的问题：视觉标签被翻译了，可访问名却没有。
- **建议**：把 `<label>` 与输入统一为「包裹式」（改造成本最低，无需生成 id），一次性覆盖 `TirisfalLogin`、`VaultEditor`、`ImportPage`、`BackupCenterPage` 四个重表单文件；可加 `eslint-plugin-jsx-a11y` 的 `label-has-associated-control` 防回归。

### P1-7 用户可见的英文错误：`lib/api` 有 81 处英文 `new Error('...')` 直接透传到 toast

- **证据（事实）**
  - 统计：`lib/api/*.ts` 中 `new Error('…')` 字面量 **81 处**，而 `t('txt…')` 只有 35 处。
  - 例：`webapp/src/lib/api/vault.ts:32`（`'Vault key unavailable'`）、`:41`（`'Create folder failed'`）、`:60`、`:383`（`'Download attachment failed'`）；`webapp/src/lib/api/auth.ts:496`（`'Failed to load profile'`）、`:475`（`'Session expired'`）。
  - 透传路径：`webapp/src/App.tsx:523` `pushToast('error', error instanceof Error ? error.message : t('txt_login_failed'))`、`App.tsx:541`、`webapp/src/components/VaultPage.tsx:782` 同样的 `error.message` 分支。
- **影响（判断）**：中文/俄语/西语界面下，登录失败、附件下载失败等**最需要被理解的时刻**弹出英文技术字符串（`Vault key unavailable` 对用户也没有行动指引）。这与 `i18n.ts:1-6` 声明的「locale 契约」自相矛盾。
- **建议**：`lib/api` 只抛错误码（如 `createApiError('err_vault_key_unavailable', status)`），UI 层统一 `t(err.code)`；过渡期可先在 `App.tsx:523/541` 与 `VaultPage.tsx:782` 3 个透传点做「已知英文→key」映射。
- **附带（事实）**：`webapp/src/lib/i18n/locales/zh-CN.ts:389` 与 `zh-TW.ts:389` 的 `txt_delete_selected_items_permanently` 仍是英文原文 `"Delete Selected Items Permanently"`（es 已译）。5 套 locale 键集完全一致（各 907 键，无缺失/多余），仅此 1 条 + `txt_tirisfal_send` 属专名，翻译整体是健康的。

### P2-1 死代码：873 行组件 + 642 行未引入 CSS + 一个空转路由

- **证据（事实）**
  - `webapp/src/components/ModernAppShell.tsx`（191 行）、`ModernLogin.tsx`（320 行）、`ModernSecretsManager.tsx`（362 行）：`rg 'Modern(AppShell|SecretsManager|Login)'` 只在各自文件内命中，**无任何引用**；三者内还有硬编码中文（`ModernSecretsManager.tsx:77,84,181,274`）绕过 i18n。
  - `webapp/src/styles/modern.css`（642 行）未被任何文件 `@import`（见 P1-3）。
  - `webapp/src/components/AppMainRoutes.tsx:388-390`：`/help` 路由只渲染 `LegacyBackupRedirect`（`AppMainRoutes.tsx:28-33`，`useEffect` 依赖 `[props]` 即每次渲染都跳转），而 `/help` 仍写在路由白名单里（`App.tsx:104`）。全仓无任何导航项指向 `/help`。
- **影响（判断）**：约 1,500 行需要维护/审阅/翻译成本为零收益；`Modern*` 里的硬编码中文会被后续维护者当成"另一套 UI"复制，是 i18n 回潮的入口。
- **建议**：删 3 个 `Modern*.tsx` + `modern.css`；`/help` 从 `APP_ROUTE_PATHS` 与 `AppMainRoutes` 一并移除（或改成真正的帮助页）。

### P2-2 分层反向依赖：`hooks/` 与 `lib/` 从 `components/` 取类型

- **证据（事实）**
  - `webapp/src/hooks/useVaultSendActions.ts:2` ← `import type { ImportAttachmentFile, ImportResultSummary } from '@/components/ImportPage'`
  - `webapp/src/hooks/useAdminActions.ts:4`、`webapp/src/hooks/useAccountSecurityActions.ts:18` ← `import type { AppConfirmState } from '@/components/AppGlobalOverlays'`
  - `webapp/src/lib/app-support.ts:4` ← `import type { ImportResultSummary } from '@/components/ImportPage'`
  - `webapp/src/lib/demo.ts:1`、`demo.empty.ts:1` ← `import type { AppMainRoutesProps } from '@/components/AppMainRoutes'`
  - 反向（`lib → hooks`）为 0，说明依赖方向只在「类型」这一层破了口。
- **影响（判断）**：类型只能 `import type`，运行时无环，所以现在**没有**构建/运行问题；但它让“页面组件”成为领域类型的实际所有者——以后把 `ImportPage` 拆走或换路由方案，`hooks` 会被迫跟着改，测试也无法独立构造这些类型。
- **建议**：把这些类型下沉到 `lib/types.ts`（`ImportAttachmentFile`/`ImportResultSummary`/`AppConfirmState`/`MainRoutesProps`），`components` 反向 import。改动 5 个文件，纯类型移动，风险低。

### P2-3 `useVaultSendActions`（1,118 行）单 hook 混装三域，错误处理 21 处复制粘贴

- **证据（事实）**
  - `webapp/src/hooks/useVaultSendActions.ts:226` 单个 hook，`:249` 一个巨型 `useMemo` 返回约 60 个 handler；文件内 `catch (error)` **21 处**、`onNotify('error'…` **24 处**，形态基本相同的 `try { … } catch (error) { onNotify('error', error instanceof Error ? error.message : t('…')) }`。
  - 同一 hook 内并存：vault CRUD（`createVaultItem`/`bulkMoveCiphers`…）、send 域（`createSend`/`updateSend`）、import/export（`:887-1118` 的 `getPlainJson`/`zipAttachments`/`buildTirisfalAttachmentRecords`，含 ZIP+Argon2+加密 6 条分支）。
  - 对照：`useAccountSecurityActions.ts`（290 行）、`useAdminActions.ts`（100 行）、`useBackupActions.ts`（106 行）都遵守了「一个 hook 一个域」。
- **影响（判断）**：导出逻辑（P1 级安全敏感路径：明文 JSON 落盘）藏在 1,118 行的 hook 尾部，review 与测试成本极高；21 处 catch 的 message 处理不一致时会产生 P1-7 那类英文泄漏。
- **建议**：按域拆 `hooks/vault/useVaultActions.ts`、`hooks/send/useSendActions.ts`、`hooks/io/useImportExport.ts`（导出可进一步下沉到 `lib/export/`，与 `lib/export-formats.ts` 同层），并抽 `withNotify(fn, key)` 统一 catch。

### P2-4 `<html lang>` 与 `<title>` 写死、首帧换语言/主题闪烁

- **证据（事实）**
  - `webapp/index.html:2` `<html lang="zh-CN" data-theme="dark">`、`:37` `<title>Tirisfal - Secure Password Manager</title>`（英文）；全仓无任何代码设置 `documentElement.lang`（`rg 'documentElement' ` 只有 `App.tsx:319-320` 设 `dataset.theme`/`colorScheme`）。
  - `webapp/src/main.tsx:20-22` 先 `renderApp()`，`:30-33` `initI18n().then(() => renderApp())` 再渲一次；`i18n.ts:33` 初始化 `activeMessages = enMessages`。
- **影响（判断）**：俄语用户在登录取证时页面声明是中文（影响读屏发音与浏览器翻译提示）；非英文用户首帧会看到英文再跳中文（`initI18n` 是异步 `import()`，热路径上必然有一次闪烁）；`data-theme="dark"` 写死使得浅色偏好的用户在 JS 执行前先被闪一下深色 boot 屏。
- **建议**：`main.tsx` 只渲一次（`await initI18n()` 后再 `render`，`index.html` 的 boot-screen 已覆盖白屏）；`setLocale`/`initI18n` 成功后同步 `document.documentElement.lang = locale`；`index.html` 去掉写死的 `data-theme`，改用内联 `<script>` 依 `localStorage`+`prefers-color-scheme` 预设。

### P2-5 非管理员访问 `/backup`、`/help` 得到空白内容区（无提示、无 404）

- **证据（事实）**：`webapp/src/components/AppMainRoutes.tsx:400-433` 的 `/backup` 路由在 `!isAdmin` 时渲染 `null`；`/help`（`:388`）重定向到 `/backup`。`App.tsx:93-107` 的 `APP_ROUTE_PATHS` 认定这些路径"已知"，因此不会落到 `NotFoundPage`。
- **影响（判断）**：普通用户手输/收藏 `/backup` 后看到侧栏+顶栏+一片空白，无法判断是加载失败还是无权限。**【待确认】** 线上是否真的把该路由暴露给了非管理员（后端是否也有 403 兜底）。
- **建议**：非 admin 分支渲染统一的 `<EmptyState title={t('txt_no_permission')}>` 或直接 `navigate('/vault')`；`/help` 一并处理。

---

## 补充结论（针对任务清单中的疑问，非缺陷）

1. **`lib/demo.ts`（1,187 行）不污染生产包 —— 【事实】**：`webapp/vite.config.ts:88-98` 用 `resolve.alias` 把 `@/lib/demo` 指向生产版 `lib/demo.empty.ts`（42 行），`@/lib/demo-brand-icons` 同理；`isDemo` 只在 `mode === 'demo'` 时为真，并额外关闭 `noindex` 与资源优先级插件。`demo.empty.ts` 里 `createDemoCompletedLogin()` 直接 `throw`，类型契约完整。**唯一代价（判断）**：`demo.empty.ts:1` 从 `@/components/AppMainRoutes` 取 `AppMainRoutesProps`，使「演示层」成为路由 props 的第二个消费者，属于 P2-2 的同源问题。
2. **`App.tsx` 1,726 行不是"文件太长"，而是"根组件兼任状态总线"**：31 个 `useEffect` 里超过一半是 localStorage 持久化（`App.tsx:316-330`、`:331-334`…）+ 查询桥接。真正的拆分切口是 `useAppSession()`/`useAppPreferences()`/`useVaultRuntime()` 三个 hook，而不是继续往外搬 JSX。
3. **虚拟化与竞态这两块现状良好 —— 【事实】**：`VaultListPanel` 用 `virtualRange`+`VAULT_LIST_ROW_HEIGHT/OVERSCAN`（`vault-page-helpers.tsx:44-45`）做窗口化，列表项 `memo`；搜索有 90ms 防抖（`VaultPage.tsx:283`）；`selectedCipherId` 会在过滤后自动纠正（`VaultPage.tsx:420-426`）；登录提示、域规则保存都用序号 ref 防竞态（`App.tsx:234,236`）；`refreshVaultSilently` 用 `pendingVaultCoreRefreshRef` 合并并发请求（`App.tsx:1146-1158`）。这些不要动。
4. **对话框原语可作标杆 —— 【事实】**：`ConfirmDialog.tsx:74-142` 具备 `role="dialog"`/`aria-modal`/`aria-labelledby`、Tab 循环、焦点归还与 `body` 计数锁。P1-5/P1-6 的修法应当沿用这套标准，而不是另立体系。

---

## 建议的目标目录结构（最小改动版）

> 原则：**只做移动与合并，不引入新框架、不改构建链**；每步可独立提交、可单独回滚。

```text
webapp/src/
├── ui/                     # 新增：无业务语义的基元（从 components/ 抽，含 P1-5/P1-6 的修复点）
│   ├── Button.tsx          # 收敛 btn/btn-primary/btn-danger（styles.css:60-140 的类名保留，组件内组装）
│   ├── Field.tsx           # <label> 包裹式 + id 自动生成 → 一招解决 128 个 input 的关联问题
│   ├── InlineError.tsx     # role="alert"，替换 SecurityDevicePage:95 / AdminPage:54 / DomainRulePage:375
│   ├── EmptyState.tsx      # 承接 P2-5 的空白页
│   └── Dialog.tsx          # 直接平移 ConfirmDialog.tsx 的焦点/aria 逻辑（保留 useDialogLifecycle 导出）
├── features/               # 新增：按域切分，现 components/ 里的页面整体迁入
│   ├── vault/               # VaultPage 1,254 行 → VaultPage(容器) + ListPanel + Detail + Editor + Dialogs
│   │   ├── VaultPage.tsx    #   + useVaultSelection / useVaultDraft / useVaultTotp（吃掉 29 useState）
│   │   ├── components/      #   现有 components/vault/* 平移，vault-page-helpers.tsx 拆为
│   │   │                    #   vault/constants.ts + vault/icons.tsx + vault/filters.ts
│   │   └── hooks/
│   ├── send/                # SendPage + PublicSendPage
│   ├── backup/              # BackupCenterPage + backup-center/*（已成型，仅上移）
│   ├── settings/            # SettingsPage + AccountSecurity + DomainRules
│   ├── admin/               # AdminPage
│   └── auth/                # TirisfalLogin + AuthViews + LoginPage / UnlockPage / RegisterPage / Recover2FA
├── shell/                   # App.tsx 拆分后的壳层
│   ├── App.tsx              # 目标 ≤400 行：只留 phase 路由与三段 JSX
│   └── hooks/               # useAppSession / useAppPreferences(主题·锁屏超时) / useVaultRuntime(解密·同步·SignalR)
├── hooks/                   # 仅保留跨域 hook；useVaultSendActions 拆 3 份（P2-3）
├── lib/                     # 不变，仅接收下沉的类型（P2-2）与 export/ 子目录
├── styles/                  # 删除 modern.css；--text-muted/--bg-secondary/--brand 归并进 tokens.css（P1-3）
└── lib/i18n/locales/        # 不变（键集已对齐，907×5）

# 构建侧（P1-1，改 2 个文件）
vite.config.ts   manualChunks：删除 app-suite 聚合，改为 per-route（vault / import / backup / settings / admin）
                 resourcePriorityPlugin：仅保留 index.css + index.js 的 high 优先级
```

**迁移顺序建议（每步独立可验证）**

1. `ui/Field.tsx` + `ui/InlineError.tsx` + Toast `aria-live`（P1-5/P1-6，触点独立、无状态耦合）
2. `vite.config.ts` 分包 + 删死代码（P1-1、P2-1，纯构建/删除，回归面小）
3. `tokens.css` 变量归并（P1-3，纯 CSS，视觉回归靠截图对比）
4. 类型下沉到 `lib/types.ts`（P2-2，纯类型，`tsc --noEmit` 即验证）
5. `useVaultSendActions` 三域拆分 + `withNotify`（P2-3，改动面最大，放在有 e2e 覆盖后）
6. `VaultPage` 拆 hook、`App.tsx` 拆壳（P1-2 的配套，最后做）

---

*本报告仅依据静态阅读与只读命令产出；未运行构建、测试或浏览器验证。标注【待确认】的条目需要运行时数据或后端上下文。*

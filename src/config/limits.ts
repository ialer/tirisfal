export const LIMITS = {
  auth: {
    // 访问令牌有效期（秒）
    accessTokenTtlSeconds: 7200,
    // 刷新令牌有效期（毫秒）
    refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000,
    // 刷新令牌轮换后的旧令牌宽限窗口（毫秒）
    refreshTokenOverlapGraceMs: 60 * 1000,
    // 刷新令牌随机字节长度
    refreshTokenRandomBytes: 32,
    // 附件下载令牌有效期（秒）
    fileDownloadTokenTtlSeconds: 300,
    // Send 访问令牌有效期（秒）
    sendAccessTokenTtlSeconds: 300,
    // JWT 密钥最小长度要求
    jwtSecretMinLength: 32,
    // 账户创建与预登录回退使用的默认 PBKDF2 迭代次数
    defaultKdfIterations: 600000,
    // clientSecret 长度
    clientSecretLength: 30,
  },
  // 输入长度限制
  input: {
    // 邮箱最大长度
    maxEmailLength: 256,
    // 密码最大长度
    maxPasswordLength: 1024,
    // 用户名最大长度
    maxNameLength: 128,
    // 密码提示最大长度
    maxPasswordHintLength: 120,
    // 笔记最大长度
    maxNotesLength: 10000,
    // 自定义字段名最大长度
    maxFieldNameLength: 256,
    // 自定义字段值最大长度
    maxFieldValueLength: 10000,
  },
  rateLimit: {
    // 触发临时锁定前允许的最大登录失败次数
    loginMaxAttempts: 5,
    // 登录锁定时长（分钟）
    loginLockoutMinutes: 15,
    // 认证 API 每用户每分钟请求配额（读写合计）
    apiRequestsPerMinute: 200,
    // 公开（未认证）接口每 IP 每分钟请求配额
    publicRequestsPerMinute: 60,
    // 公开只读接口每 IP 每分钟请求配额
    publicReadRequestsPerMinute: 120,
    // 敏感公开/认证接口每 IP 每分钟请求配额
    sensitivePublicRequestsPerMinute: 30,
    // 密码提示查询接口每 IP 每分钟请求配额
    passwordHintRequestsPerMinute: 1,
    // 密码提示查询接口每 IP 每小时请求配额
    passwordHintRequestsPerHour: 3,
    // 注册接口每 IP 每分钟请求配额
    registerRequestsPerMinute: 5,
    // refresh_token 授权每 IP 每分钟请求配额
    refreshTokenRequestsPerMinute: 30,
    // API 限流固定窗口大小（秒）
    apiWindowSeconds: 60,
    // 在请求路径中触发低频清理的概率
    cleanupProbability: 0.05,
    // 登录尝试表清理的最小间隔
    loginIpCleanupIntervalMs: 10 * 60 * 1000,
    // 登录 IP 记录保留时长
    loginIpRetentionMs: 30 * 24 * 60 * 60 * 1000,
  },
  cleanup: {
    // refresh_token 表清理最小间隔
    refreshTokenCleanupIntervalMs: 30 * 60 * 1000,
    // 已使用附件令牌表清理最小间隔
    attachmentTokenCleanupIntervalMs: 10 * 60 * 1000,
    // 请求过程中触发清理的概率
    cleanupProbability: 0.05,
  },
  attachment: {
    // 附件上传大小上限（字节）
    maxFileSizeBytes: 100 * 1024 * 1024,
  },
  send: {
    // Send 文件上传大小上限
    maxFileSizeBytes: 100 * 1024 * 1024,
    // 允许的最远删除日期（距当前天数）
    maxDeletionDays: 31,
  },
  pagination: {
    // 客户端未传 pageSize 时的默认分页大小
    defaultPageSize: 100,
    // 服务端允许的最大分页大小
    maxPageSize: 500,
  },
  cors: {
    // 浏览器预检请求缓存时长（秒）
    preflightMaxAgeSeconds: 86400,
  },
  cache: {
    // 图标代理缓存时长（秒）
    iconTtlSeconds: 604800,
    // /api/sync 内存缓存有效期（毫秒）
    syncResponseTtlMs: 30 * 1000,
    // 单个 /api/sync 缓存响应允许的最大字节数
    syncResponseMaxBodyBytes: 512 * 1024,
    // 每个 isolate 中 /api/sync 缓存允许占用的最大总字节数
    syncResponseMaxTotalBytes: 2 * 1024 * 1024,
    // 每个 isolate 的 /api/sync 最大缓存条目数
    syncResponseMaxEntries: 64,
  },
  performance: {
    // 批量移动密码项时每批 SQL 的最大 ID 数量
    bulkMoveChunkSize: 200,
    // 单次导入允许的最大条目数（文件夹 + 密码项合计）
    importItemLimit: 5000,
    // 附件 / blob 批量清理时的保守并发数
    attachmentDeleteConcurrency: 4,
  },
  request: {
    // JSON 接口请求 body 大小上限（字节），文件上传接口除外
    maxBodyBytes: 25 * 1024 * 1024,
  },
  compatibility: {
    // /config.version 与 /api/version 的统一版本号来源
    bitwardenServerVersion: '2026.1.0',
  },
  machineAccountToken: {
    // 默认过期天数
    defaultExpiryDays: 30,
    // 最大允许过期天数
    maxExpiryDays: 90,
    // 启用自动轮换提醒
    enableRotationReminder: true,
    // 轮换提醒间隔（天）
    rotationReminderDays: 7,
  },
} as const;

import { LIMITS } from '../config/limits';

// 速率限制服务
// - 登录尝试：基于 D1（低频、安全关键，需要跨数据中心持久化）
// - API 预算：基于 D1（原子操作防止竞态条件）

const CONFIG = {
  LOGIN_MAX_ATTEMPTS: LIMITS.rateLimit.loginMaxAttempts,
  LOGIN_LOCKOUT_MINUTES: LIMITS.rateLimit.loginLockoutMinutes,
  API_WINDOW_SECONDS: LIMITS.rateLimit.apiWindowSeconds,
};

export class RateLimitService {
  private static loginIpTableReady = false;
  private static rateLimitTableReady = false;
  private static lastLoginIpCleanupAt = 0;
  private static lastRateLimitCleanupAt = 0;

  private static readonly PERIODIC_CLEANUP_PROBABILITY = LIMITS.rateLimit.cleanupProbability;
  private static readonly LOGIN_IP_CLEANUP_INTERVAL_MS = LIMITS.rateLimit.loginIpCleanupIntervalMs;
  private static readonly LOGIN_IP_RETENTION_MS = LIMITS.rateLimit.loginIpRetentionMs;
  private static readonly RATE_LIMIT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(private db: D1Database) {}

  private shouldRunCleanup(lastRunAt: number, intervalMs: number): boolean {
    const now = Date.now();
    if (now - lastRunAt < intervalMs) return false;
    return Math.random() < RateLimitService.PERIODIC_CLEANUP_PROBABILITY;
  }

  private async maybeCleanupLoginAttemptsIp(nowMs: number): Promise<void> {
    if (
      !this.shouldRunCleanup(
        RateLimitService.lastLoginIpCleanupAt,
        RateLimitService.LOGIN_IP_CLEANUP_INTERVAL_MS
      )
    ) {
      return;
    }

    const cutoff = nowMs - RateLimitService.LOGIN_IP_RETENTION_MS;
    await this.db
      .prepare(
        'DELETE FROM login_attempts_ip WHERE updated_at < ? AND (locked_until IS NULL OR locked_until < ?)'
      )
      .bind(cutoff, nowMs)
      .run();
    RateLimitService.lastLoginIpCleanupAt = nowMs;
  }

  private async ensureLoginIpTable(): Promise<void> {
    if (RateLimitService.loginIpTableReady) return;

    await this.db
      .prepare(
        'CREATE TABLE IF NOT EXISTS login_attempts_ip (' +
          'ip TEXT PRIMARY KEY, ' +
          'attempts INTEGER NOT NULL, ' +
          'locked_until INTEGER, ' +
          'updated_at INTEGER NOT NULL' +
          ')'
      )
      .run();

    RateLimitService.loginIpTableReady = true;
  }

  async checkLoginAttempt(ip: string): Promise<{
    allowed: boolean;
    remainingAttempts: number;
    retryAfterSeconds?: number;
  }> {
    await this.ensureLoginIpTable();

    const key = ip.trim() || 'unknown';
    const now = Date.now();
    await this.maybeCleanupLoginAttemptsIp(now);

    const row = await this.db
      .prepare('SELECT attempts, locked_until FROM login_attempts_ip WHERE ip = ?')
      .bind(key)
      .first<{ attempts: number; locked_until: number | null }>();

    if (!row) {
      return { allowed: true, remainingAttempts: CONFIG.LOGIN_MAX_ATTEMPTS };
    }

    if (row.locked_until && row.locked_until > now) {
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: Math.ceil((row.locked_until - now) / 1000),
      };
    }

    if (row.locked_until && row.locked_until <= now) {
      await this.db.prepare('DELETE FROM login_attempts_ip WHERE ip = ?').bind(key).run();
      return { allowed: true, remainingAttempts: CONFIG.LOGIN_MAX_ATTEMPTS };
    }

    const remainingAttempts = Math.max(0, CONFIG.LOGIN_MAX_ATTEMPTS - (row.attempts || 0));
    return { allowed: true, remainingAttempts };
  }

  async recordFailedLogin(ip: string): Promise<{ locked: boolean; retryAfterSeconds?: number }> {
    await this.ensureLoginIpTable();

    const key = ip.trim() || 'unknown';
    const now = Date.now();
    await this.maybeCleanupLoginAttemptsIp(now);

    // 使用原子 UPSERT 递增尝试次数，然后立即检查
    // 虽然不是真正事务，但单条 UPSERT 保证原子性
    await this.db
      .prepare(
        'INSERT INTO login_attempts_ip(ip, attempts, locked_until, updated_at) VALUES(?, 1, NULL, ?) ' +
          'ON CONFLICT(ip) DO UPDATE SET attempts = attempts + 1, updated_at = excluded.updated_at'
      )
      .bind(key, now)
      .run();

    // 递增后立即读取当前状态
    const row = await this.db
      .prepare('SELECT attempts, locked_until FROM login_attempts_ip WHERE ip = ?')
      .bind(key)
      .first<{ attempts: number; locked_until: number | null }>();

    const attempts = row?.attempts || 1;

    // 如果已锁定，返回锁定信息
    if (row?.locked_until && row.locked_until > now) {
      return { locked: true, retryAfterSeconds: Math.ceil((row.locked_until - now) / 1000) };
    }

    // 达到最大尝试次数，执行锁定
    if (attempts >= CONFIG.LOGIN_MAX_ATTEMPTS) {
      const lockedUntil = now + CONFIG.LOGIN_LOCKOUT_MINUTES * 60 * 1000;
      await this.db
        .prepare('UPDATE login_attempts_ip SET locked_until = ?, updated_at = ? WHERE ip = ?')
        .bind(lockedUntil, now, key)
        .run();
      return { locked: true, retryAfterSeconds: CONFIG.LOGIN_LOCKOUT_MINUTES * 60 };
    }

    return { locked: false };
  }

  async clearLoginAttempts(ip: string): Promise<void> {
    await this.ensureLoginIpTable();
    const key = ip.trim() || 'unknown';
    await this.db.prepare('DELETE FROM login_attempts_ip WHERE ip = ?').bind(key).run();
  }

  private async ensureRateLimitTable(): Promise<void> {
    if (RateLimitService.rateLimitTableReady) return;
    await this.db
      .prepare(
        'CREATE TABLE IF NOT EXISTS rate_limits (' +
          'key TEXT PRIMARY KEY, ' +
          'count INTEGER NOT NULL, ' +
          'window_start INTEGER NOT NULL, ' +
          'expires_at INTEGER NOT NULL' +
          ')'
      )
      .run();
    RateLimitService.rateLimitTableReady = true;
  }

  private async maybeCleanupRateLimits(nowSec: number): Promise<void> {
    if (nowSec - RateLimitService.lastRateLimitCleanupAt < RateLimitService.RATE_LIMIT_CLEANUP_INTERVAL_MS / 1000) {
      return;
    }
    await this.db
      .prepare('DELETE FROM rate_limits WHERE expires_at < ?')
      .bind(nowSec)
      .run();
    RateLimitService.lastRateLimitCleanupAt = nowSec;
  }

  // 基于 D1 的固定窗口速率限制器，使用原子操作
  // 使用 UPSERT 防止并发请求间的竞态条件
  private async consumeFixedWindowBudget(
    identifier: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds?: number }> {
    await this.ensureRateLimitTable();

    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - (nowSec % windowSeconds);
    const windowEnd = windowStart + windowSeconds;
    const ttl = Math.max(1, windowEnd - nowSec);

    // 原子递增，使用 UPSERT 防止竞态条件
    await this.db
      .prepare(
        'INSERT INTO rate_limits(key, count, window_start, expires_at) VALUES(?, 1, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET count = count + 1, expires_at = excluded.expires_at ' +
          'WHERE window_start = excluded.window_start'
      )
      .bind(identifier, windowStart, windowEnd)
      .run();

    const row = await this.db
      .prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?')
      .bind(identifier, windowStart)
      .first<{ count: number }>();

    const count = row?.count || 1;

    // 检查是否超出限制
    if (count > maxRequests) {
      return { allowed: false, remaining: 0, retryAfterSeconds: ttl };
    }

    // 定期清理过期条目
    await this.maybeCleanupRateLimits(nowSec);

    return { allowed: true, remaining: Math.max(0, maxRequests - count) };
  }

  // 通用固定窗口预算
  // 调用方提供标识符（每个速率限制类别必须唯一）和每窗口最大值。
  // 此单一方法替代所有先前的专用预算辅助函数（write/sync/knownDevice/publicSend）
  async consumeBudget(
    identifier: string,
    maxRequests: number
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds?: number }> {
    return this.consumeFixedWindowBudget(identifier, maxRequests, CONFIG.API_WINDOW_SECONDS);
  }

  async consumeBudgetWithWindow(
    identifier: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds?: number }> {
    return this.consumeFixedWindowBudget(identifier, maxRequests, windowSeconds);
  }
}

function parseIpv4Octets(input: string): number[] | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function parseIpv6Hextets(input: string): number[] | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;

  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }
  const zoneIndex = value.indexOf('%');
  if (zoneIndex >= 0) {
    value = value.slice(0, zoneIndex);
  }
  if (!value.includes(':')) return null;

  // 处理 IPv4 映射尾部（如 ::ffff:192.0.2.1）
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    if (lastColon < 0) return null;
    const ipv4Tail = value.slice(lastColon + 1);
    const octets = parseIpv4Octets(ipv4Tail);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${value.slice(0, lastColon)}:${high}:${low}`;
  }

  const doubleColon = value.indexOf('::');
  if (doubleColon !== value.lastIndexOf('::')) return null;

  const parsePart = (part: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    const n = parseInt(part, 16);
    return Number.isNaN(n) ? null : n;
  };

  const parseParts = (parts: string[]): number[] | null => {
    const out: number[] = [];
    for (const p of parts) {
      if (!p) return null;
      const n = parsePart(p);
      if (n === null) return null;
      out.push(n);
    }
    return out;
  };

  if (doubleColon >= 0) {
    const [headRaw, tailRaw] = value.split('::');
    const head = headRaw ? headRaw.split(':') : [];
    const tail = tailRaw ? tailRaw.split(':') : [];

    const headNums = parseParts(head);
    const tailNums = parseParts(tail);
    if (!headNums || !tailNums) return null;

    const missing = 8 - (headNums.length + tailNums.length);
    if (missing < 1) return null;

    return [...headNums, ...new Array<number>(missing).fill(0), ...tailNums];
  }

  const all = parseParts(value.split(':'));
  if (!all || all.length !== 8) return null;
  return all;
}

function normalizeClientIpForRateLimit(rawIp: string): string | null {
  const input = rawIp.trim();
  if (!input) return null;

  const ipv4 = parseIpv4Octets(input);
  if (ipv4) {
    return `ip4:${ipv4.join('.')}`;
  }

  const ipv6 = parseIpv6Hextets(input);
  if (!ipv6) return null;

  // 处理 IPv4 映射/兼容的 IPv6 作为 IPv4 标识
  // 示例：::ffff:192.0.2.1, ::192.0.2.1
  if (
    ipv6[0] === 0 &&
    ipv6[1] === 0 &&
    ipv6[2] === 0 &&
    ipv6[3] === 0 &&
    ipv6[4] === 0 &&
    (ipv6[5] === 0xffff || ipv6[5] === 0)
  ) {
    const octets = [ipv6[6] >> 8, ipv6[6] & 0xff, ipv6[7] >> 8, ipv6[7] & 0xff];
    return `ip4:${octets.join('.')}`;
  }

  // 折叠为 /64 以减少通过 IPv6 地址轮换的暴力破解绕过
  const prefix64 = ipv6
    .slice(0, 4)
    .map((part) => part.toString(16).padStart(4, '0'))
    .join(':');
  return `ip6:${prefix64}`;
}

function isLocalRequest(request: Request): boolean {
  const isLoopbackHost = (host: string | null): boolean => {
    if (!host) return false;
    const normalized = host.split(':')[0].trim().toLowerCase();
    return (
      normalized === 'localhost' ||
      normalized.endsWith('.localhost') ||
      normalized === '127.0.0.1' ||
      normalized === '0.0.0.0' ||
      normalized === '::1' ||
      normalized === '[::1]'
    );
  };

  try {
    if (isLoopbackHost(new URL(request.url).hostname)) return true;
  } catch {
    // Ignore malformed URL and fall back to Host header check.
  }

  return isLoopbackHost(request.headers.get('Host'));
}

export function getClientIdentifier(request: Request): string | null {
  // Strict fallback order:
  // 1) CF-Connecting-IP
  // 2) X-Real-IP
  // 3) first item of X-Forwarded-For
  // If none are present/valid, treat client IP as unavailable.
  const candidates: Array<string | null> = [
    request.headers.get('CF-Connecting-IP'),
    request.headers.get('X-Real-IP'),
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || null,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const normalized = normalizeClientIpForRateLimit(raw);
    if (normalized) return normalized;
  }

  // Local dev (wrangler dev / localhost): allow a deterministic loopback identifier.
  if (isLocalRequest(request)) {
    return 'ip4:127.0.0.1';
  }

  return null;
}

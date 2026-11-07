import { LIMITS } from '../config/limits';

// 速率限制服务
// - 登录尝试：基于 D1（低频、安全关键，需要跨数据中心持久化）
// - API 预算：基于 D1（原子操作防止竞态条件）

const CONFIG = {
  LOGIN_MAX_ATTEMPTS: LIMITS.rateLimit.loginMaxAttempts,
  LOGIN_LOCKOUT_MINUTES: LIMITS.rateLimit.loginLockoutMinutes,
  API_WINDOW_SECONDS: LIMITS.rateLimit.apiWindowSeconds,
};

/**
 * 固定窗口计数器 UPSERT：
 * - 同一窗口：count + 1
 * - 窗口滚动：count 重置为 1，并推进 window_start
 * 导出的目的是让回归测试直接验证 SQL 语义（换窗必须重置）。
 */
export const RATE_LIMIT_UPSERT_SQL =
  'INSERT INTO rate_limits(key, count, window_start, expires_at) VALUES(?, 1, ?, ?) ' +
  'ON CONFLICT(key) DO UPDATE SET ' +
  'count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END, ' +
  'window_start = excluded.window_start, ' +
  'expires_at = excluded.expires_at';

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

  async checkLoginAttempt(
    ip: string,
    maxAttempts: number = CONFIG.LOGIN_MAX_ATTEMPTS
  ): Promise<{
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
      return { allowed: true, remainingAttempts: maxAttempts };
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
      return { allowed: true, remainingAttempts: maxAttempts };
    }

    const remainingAttempts = Math.max(0, maxAttempts - (row.attempts || 0));
    return { allowed: true, remainingAttempts };
  }

  async recordFailedLogin(
    ip: string,
    maxAttempts: number = CONFIG.LOGIN_MAX_ATTEMPTS
  ): Promise<{ locked: boolean; retryAfterSeconds?: number }> {
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
    if (attempts >= maxAttempts) {
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
    if (
      nowSec - RateLimitService.lastRateLimitCleanupAt <
      RateLimitService.RATE_LIMIT_CLEANUP_INTERVAL_MS / 1000
    ) {
      return;
    }
    await this.db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(nowSec).run();
    RateLimitService.lastRateLimitCleanupAt = nowSec;
  }

  // 基于 D1 的固定窗口速率限制器，使用原子操作
  // 使用 UPSERT 防止并发请求间的竞态条件。
  // 关键：换窗时必须重置计数（CASE WHEN），不能依赖 DO UPDATE 的 WHERE——
  // 后者在窗口变化时整行不更新，新窗口查询取不到行，导致限流永久失效。
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
    await this.db.prepare(RATE_LIMIT_UPSERT_SQL).bind(identifier, windowStart, windowEnd).run();

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

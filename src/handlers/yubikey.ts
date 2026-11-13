import { LIMITS } from '../config/limits';
import { AuthService } from '../services/auth';
import { RateLimitService } from '../services/ratelimit';
import { StorageService } from '../services/storage';
import { isYubikeyConfigured, verifyYubikeyOtp } from '../services/yubikey';
import type { Env } from '../types';
import { errorResponse, jsonResponse } from '../utils/response';

const LIST_PATH = '/two-factor/yubikey';

/** 审计只记录公钥 ID 前 4 位，不含 OTP */
async function auditYubikey(
  env: Env,
  userId: string,
  action: string,
  publicId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        crypto.randomUUID(),
        userId,
        action,
        'yubikey',
        publicId.slice(0, 4),
        JSON.stringify(metadata),
        new Date().toISOString()
      )
      .run();
  } catch (error) {
    console.error('yubikey audit failed:', error);
  }
}
const API_LIST_PATH = '/api/two-factor/yubikey';

/**
 * YubiKey OTP 两步验证管理。
 * - GET    列表
 * - POST   绑定：{ masterPasswordHash, otp, name? }
 * - DELETE /two-factor/yubikey/:id：{ masterPasswordHash }
 * 登录第二步仍走 /identity/connect/token 的 twoFactorProvider=3 + twoFactorToken=OTP。
 */
export async function handleYubikeyRoute(
  request: Request,
  env: Env,
  path: string,
  method: string,
  userId: string
): Promise<Response> {
  const storage = new StorageService(env.DB);
  const auth = new AuthService(env);
  const user = await storage.getUserById(userId);
  if (!user) return errorResponse('User not found', 404);

  if (path === LIST_PATH || path === API_LIST_PATH) {
    if (method === 'GET') {
      const keys = await storage.listYubikeys(userId);
      return jsonResponse({
        object: 'list',
        data: keys.map((k) => ({
          id: k.id,
          name: k.name,
          // 只回显公钥 ID 的前 4 位，够识别即可
          publicId: `${k.public_id.slice(0, 4)}***`,
          createdAt: k.created_at,
          lastUsedAt: k.last_used_at,
        })),
        enabled: isYubikeyConfigured(env),
      });
    }

    if (method === 'POST') {
      // OTP 校验会打到外部服务：按用户限速，避免被当成 OTP 试探/打爆校验服务
      const rateLimit = new RateLimitService(env.DB);
      const limited = await rateLimit.consumeBudget(
        `${userId}:yubikey-bind`,
        LIMITS.rateLimit.sensitivePublicRequestsPerMinute
      );
      if (!limited.allowed) {
        return errorResponse(
          `Too many YubiKey attempts. Retry in ${limited.retryAfterSeconds} seconds.`,
          429
        );
      }
      if (!isYubikeyConfigured(env)) {
        return errorResponse('YubiKey OTP is not configured on this server', 400);
      }
      let body: { masterPasswordHash?: string; otp?: string; name?: string };
      try {
        body = await request.json();
      } catch {
        return errorResponse('Invalid JSON', 400);
      }
      if (!body.masterPasswordHash) return errorResponse('masterPasswordHash is required', 400);
      const passwordOk = await auth.verifyPassword(
        body.masterPasswordHash,
        user.masterPasswordHash,
        user.email
      );
      if (!passwordOk) return errorResponse('Invalid password', 401);

      const otp = String(body.otp || '').trim();
      if (!otp) return errorResponse('otp is required', 400);
      const result = await verifyYubikeyOtp(env, otp);
      if (!result.ok || !result.publicId) {
        return errorResponse(`Invalid YubiKey OTP: ${result.status}`, 400);
      }

      const existing = await storage.findYubikeyByPublicId(userId, result.publicId);
      if (existing) return errorResponse('This YubiKey is already registered', 409);
      // 全局唯一：同一个公钥 ID 不能绑到第二个账号（UNIQUE 约束会 500，这里显式 409）
      const owner = await storage.findYubikeyOwner(result.publicId);
      if (owner) return errorResponse('This YubiKey is already registered to another account', 409);

      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : null;
      await storage.addYubikey(userId, result.publicId, name || null);
      return jsonResponse({ success: true, publicId: `${result.publicId.slice(0, 4)}***` });
    }

    return errorResponse('Method not allowed', 405);
  }

  const match = path.match(/^(?:\/api)?\/two-factor\/yubikey\/([a-f0-9-]+)$/i);
  if (match && method === 'DELETE') {
    let body: { masterPasswordHash?: string };
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON', 400);
    }
    if (!body.masterPasswordHash) return errorResponse('masterPasswordHash is required', 400);
    const passwordOk = await auth.verifyPassword(
      body.masterPasswordHash,
      user.masterPasswordHash,
      user.email
    );
    if (!passwordOk) return errorResponse('Invalid password', 401);

    const keys = await storage.listYubikeys(userId);
    const target = keys.find((k) => k.id === match[1]);
    const removed = await storage.deleteYubikey(userId, match[1]);
    if (!removed) return errorResponse('Not found', 404);
    await auditYubikey(env, userId, 'yubikey.unbind', target?.public_id ?? match[1], {});
    return jsonResponse({ success: true });
  }

  return errorResponse('Not found', 404);
}

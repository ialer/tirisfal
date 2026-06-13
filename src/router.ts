import { LIMITS } from './config/limits';
import { handleHealthCheck } from './handlers/health';
import { handleAuthenticatedRoute } from './router-authenticated';
import { handlePublicRoute } from './router-public';
import { handleSmRoute } from './router-sm';
import { AuthService } from './services/auth';
import { getClientIdentifier, RateLimitService } from './services/ratelimit';
import type { Env } from './types';
import { DEFAULT_DEV_SECRET } from './types';
import { errorResponse, handleCors, jsonResponse, rateLimitResponse } from './utils/response';

/** 检查 JWT 密钥是否不安全 */
function jwtSecretUnsafeReason(env: Env): 'missing' | 'default' | 'too_short' | null {
  const secret = (env.JWT_SECRET || '').trim();
  if (!secret) return 'missing';
  if (secret === DEFAULT_DEV_SECRET) return 'default';
  if (secret.length < LIMITS.auth.jwtSecretMinLength) return 'too_short';
  return null;
}

/** 检查加密密钥是否不安全 */
function encryptionKeyUnsafeReason(env: Env): 'missing' | 'too_weak' | null {
  const key = (env.ENCRYPTION_KEY || '').trim();
  if (!key) return 'missing';
  if (key.length < 32) return 'too_weak';
  return null;
}

/**
 * 主请求处理函数
 * 负责路由分发、身份验证、速率限制和错误处理
 */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const clientId = getClientIdentifier(request);

  /** 执行公开接口速率限制 */
  async function enforcePublicRateLimit(
    category: string = 'public',
    maxRequests: number = LIMITS.rateLimit.publicRequestsPerMinute
  ): Promise<Response | null> {
    if (!clientId) {
      return errorResponse('需要客户端 IP', 403);
    }
    const rateLimit = new RateLimitService(env.DB);
    const check = await rateLimit.consumeBudget(`${clientId}:${category}`, maxRequests);
    return check.allowed ? null : rateLimitResponse(check.retryAfterSeconds);
  }

  if (method === 'OPTIONS') return handleCors(request);
  if (path === '/health' || path === '/api/health') return handleHealthCheck(request, env);

  try {
    // 文件上传接口豁免 body 大小限制
    const isLargeUpload =
      /^\/api\/ciphers\/[a-f0-9-]+\/attachment\/[a-f0-9-]+$/i.test(path) ||
      /^\/api\/sends\/[a-f0-9-]+\/file\/[a-f0-9-]+$/i.test(path) ||
      path === '/api/admin/backup/import';
    if (!isLargeUpload) {
      const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
      if (contentLength > LIMITS.request.maxBodyBytes) return errorResponse('请求体过大', 413);
    }

    // 尝试公开路由
    const publicResponse = await handlePublicRoute(request, env, path, method, enforcePublicRateLimit);
    if (publicResponse) return publicResponse;

    // 检查安全配置
    if (jwtSecretUnsafeReason(env)) return errorResponse('JWT_SECRET 未设置或强度不足', 500);
    if (encryptionKeyUnsafeReason(env)) return errorResponse('ENCRYPTION_KEY 未设置或强度不足', 500);

    // 验证访问令牌
    const auth = new AuthService(env);
    const verified = await auth.verifyAccessTokenWithUser(request.headers.get('Authorization'));
    if (!verified) return errorResponse('未授权', 401);

    const { payload, user: currentUser } = verified;
    if (currentUser.status !== 'active') return errorResponse('账户已禁用', 403);

    // 注入当前设备 ID 到请求头
    const actingDeviceId = String(payload.did || '').trim();
    if (actingDeviceId) {
      const headers = new Headers(request.headers);
      headers.set('X-Tirisfal-Acting-Device-Id', actingDeviceId);
      request = new Request(request, { headers });
    }

    // 认证接口速率限制
    const rateLimit = new RateLimitService(env.DB);
    const apiCheck = await rateLimit.consumeBudget(`${payload.sub}:api`, LIMITS.rateLimit.apiRequestsPerMinute);
    if (!apiCheck.allowed) return rateLimitResponse(apiCheck.retryAfterSeconds);

    // 尝试 Secrets Manager 路由
    const smResponse = await handleSmRoute(request, env, path, method);
    if (smResponse) return smResponse;

    // 尝试已认证路由
    const authResponse = await handleAuthenticatedRoute(request, env, payload.sub, currentUser, path, method);
    if (authResponse) return authResponse;

    return errorResponse('未找到', 404);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('请求错误:', errMsg);
    return errorResponse('服务器内部错误', 500);
  }
}

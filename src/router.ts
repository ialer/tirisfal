import { LIMITS } from './config/limits';
import { handleHealthCheck } from './handlers/health';
import { handleAuthenticatedRoute } from './router-authenticated';
import { handlePublicRoute } from './router-public';
import { handleSmRoute } from './router-sm';
import { AuthService } from './services/auth';
import { getClientIdentifier, RateLimitService } from './services/ratelimit';
import type { Env } from './types';
import { DEFAULT_DEV_SECRET } from './types';
import { errorResponse, handleCors } from './utils/response';

function jwtSecretUnsafeReason(env: Env): 'missing' | 'default' | 'too_short' | null {
  const secret = (env.JWT_SECRET || '').trim();
  if (!secret) return 'missing';
  if (secret === DEFAULT_DEV_SECRET) return 'default';
  if (secret.length < LIMITS.auth.jwtSecretMinLength) return 'too_short';
  return null;
}

function encryptionKeyUnsafeReason(env: Env): 'missing' | 'too_weak' | null {
  const key = (env.ENCRYPTION_KEY || '').trim();
  if (!key) return 'missing';
  // 加密密钥至少需要 32 字符（256 位）
  if (key.length < 32) return 'too_weak';
  return null;
}

// 导入绕过请求检查 - 需要额外验证防止滥用
function isImportBypassRequest(request: Request, path: string, method: string): boolean {
  // 必须有导入标记
  if (request.headers.get('X-Tirisfal-Import') !== '1') return false;

  // 只允许特定的导入路径
  if (method === 'POST') {
    if (path === '/api/ciphers/import') return true;
    if (/^\/api\/ciphers\/[a-f0-9-]+\/attachment\/v2$/i.test(path)) return true;
    if (/^\/api\/ciphers\/[a-f0-9-]+\/attachment\/[a-f0-9-]+$/i.test(path)) return true;
  }

  return false;
}

// 验证导入请求的合法性（需要额外的验证）
function validateImportRequest(request: Request): boolean {
  // 检查 Content-Type
  const contentType = request.headers.get('Content-Type');
  if (!contentType || !contentType.includes('application/json')) {
    return false;
  }

  // 检查请求大小（防止大文件攻击）
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > 25 * 1024 * 1024) { // 25MB
    return false;
  }

  return true;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const clientId = getClientIdentifier(request);

  async function enforcePublicRateLimit(
    category: string = 'public',
    maxRequests: number = LIMITS.rateLimit.publicRequestsPerMinute
  ): Promise<Response | null> {
    if (!clientId) {
      return new Response(
        JSON.stringify({
          error: 'Forbidden',
          error_description: 'Client IP is required',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const rateLimit = new RateLimitService(env.DB);
    const check = await rateLimit.consumeBudget(`${clientId}:${category}`, maxRequests);
    if (check.allowed) return null;

    return new Response(
      JSON.stringify({
        error: 'Too many requests',
        error_description: `Rate limit exceeded. Try again in ${check.retryAfterSeconds} seconds.`,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(check.retryAfterSeconds || 60),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  if (method === 'OPTIONS') {
    return handleCors(request);
  }

  // 健康检查端点
  if (path === '/health' || path === '/api/health') {
    return handleHealthCheck(request, env);
  }

  try {
    const isLargeUploadPath =
      /^\/api\/ciphers\/[a-f0-9-]+\/attachment\/[a-f0-9-]+$/i.test(path) ||
      /^\/api\/sends\/[a-f0-9-]+\/file\/[a-f0-9-]+$/i.test(path) ||
      path === '/api/admin/backup/import';
    if (!isLargeUploadPath) {
      const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
      if (contentLength > LIMITS.request.maxBodyBytes) {
        return errorResponse('Request body too large', 413);
      }
    }

    const publicResponse = await handlePublicRoute(
      request,
      env,
      path,
      method,
      enforcePublicRateLimit
    );
    if (publicResponse) return publicResponse;

    const secretIssue = jwtSecretUnsafeReason(env);
    if (secretIssue) {
      return errorResponse('Server configuration error: JWT_SECRET is not set or too weak', 500);
    }

    const encryptionIssue = encryptionKeyUnsafeReason(env);
    if (encryptionIssue) {
      return errorResponse('Server configuration error: ENCRYPTION_KEY is not set or too weak', 500);
    }

    const auth = new AuthService(env);
    const authHeader = request.headers.get('Authorization');
    const verified = await auth.verifyAccessTokenWithUser(authHeader);
    if (!verified) {
      return errorResponse('Unauthorized', 401);
    }
    const { payload, user: currentUser } = verified;

    const actingDeviceId = String(payload.did || '').trim();
    if (actingDeviceId) {
      const nextHeaders = new Headers(request.headers);
      nextHeaders.set('X-Tirisfal-Acting-Device-Id', actingDeviceId);
      request = new Request(request, { headers: nextHeaders });
    }

    const userId = payload.sub;
    if (currentUser.status !== 'active') {
      return errorResponse('Account is disabled', 403);
    }

    if (!isImportBypassRequest(request, path, method)) {
      const rateLimit = new RateLimitService(env.DB);
      const rateLimitCheck = await rateLimit.consumeBudget(
        `${userId}:api`,
        LIMITS.rateLimit.apiRequestsPerMinute
      );
      if (!rateLimitCheck.allowed) {
        return new Response(
          JSON.stringify({
            error: 'Too many requests',
            error_description: `Rate limit exceeded. Try again in ${rateLimitCheck.retryAfterSeconds} seconds.`,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(rateLimitCheck.retryAfterSeconds || 60),
              'X-RateLimit-Remaining': '0',
            },
          }
        );
      }
    }

    // 处理 Secrets Manager 路由
    const smResponse = await handleSmRoute(request, env, path, method);
    if (smResponse) return smResponse;

    const authenticatedResponse = await handleAuthenticatedRoute(
      request,
      env,
      userId,
      currentUser,
      path,
      method
    );
    if (authenticatedResponse) return authenticatedResponse;

    return errorResponse('Not found', 404);
  } catch (error) {
    console.error('Request error:', error);
    return errorResponse('Internal server error', 500);
  }
}

import { LIMITS } from './config/limits';
import { handleHealthCheck } from './handlers/health';
import { handleAuthenticatedRoute } from './router-authenticated';
import { handlePublicRoute } from './router-public';
import { handleSmRoute } from './router-sm';
import { AuthService } from './services/auth';
import { getClientIdentifier, RateLimitService } from './services/ratelimit';
import type { Env } from './types';
import { DEFAULT_DEV_SECRET } from './types';
import { errorResponse, handleCors, rateLimitResponse } from './utils/response';

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
  if (key.length < 32) return 'too_weak';
  return null;
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
      return errorResponse('Client IP is required', 403);
    }
    const rateLimit = new RateLimitService(env.DB);
    const check = await rateLimit.consumeBudget(`${clientId}:${category}`, maxRequests);
    return check.allowed ? null : rateLimitResponse(check.retryAfterSeconds);
  }

  if (method === 'OPTIONS') return handleCors(request);
  if (path === '/health' || path === '/api/health') return handleHealthCheck(request, env);

  try {
    const isLargeUpload =
      /^\/api\/ciphers\/[a-f0-9-]+\/attachment\/[a-f0-9-]+$/i.test(path) ||
      /^\/api\/sends\/[a-f0-9-]+\/file\/[a-f0-9-]+$/i.test(path) ||
      path === '/api/admin/backup/import';
    if (!isLargeUpload) {
      const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
      if (contentLength > LIMITS.request.maxBodyBytes) return errorResponse('Request body too large', 413);
    }

    const publicResponse = await handlePublicRoute(request, env, path, method, enforcePublicRateLimit);
    if (publicResponse) return publicResponse;

    if (jwtSecretUnsafeReason(env)) return errorResponse('JWT_SECRET is not set or too weak', 500);
    if (encryptionKeyUnsafeReason(env)) return errorResponse('ENCRYPTION_KEY is not set or too weak', 500);

    const auth = new AuthService(env);
    const verified = await auth.verifyAccessTokenWithUser(request.headers.get('Authorization'));
    if (!verified) return errorResponse('Unauthorized', 401);

    const { payload, user: currentUser } = verified;
    if (currentUser.status !== 'active') return errorResponse('Account is disabled', 403);

    const actingDeviceId = String(payload.did || '').trim();
    if (actingDeviceId) {
      const headers = new Headers(request.headers);
      headers.set('X-Tirisfal-Acting-Device-Id', actingDeviceId);
      request = new Request(request, { headers });
    }

    const rateLimit = new RateLimitService(env.DB);
    const apiCheck = await rateLimit.consumeBudget(`${payload.sub}:api`, LIMITS.rateLimit.apiRequestsPerMinute);
    if (!apiCheck.allowed) return rateLimitResponse(apiCheck.retryAfterSeconds);

    const smResponse = await handleSmRoute(request, env, path, method);
    if (smResponse) return smResponse;

    const authResponse = await handleAuthenticatedRoute(request, env, payload.sub, currentUser, path, method);
    if (authResponse) return authResponse;

    return errorResponse('Not found', 404);
  } catch (error) {
    console.error('Request error:', error);
    return errorResponse('Internal server error', 500);
  }
}

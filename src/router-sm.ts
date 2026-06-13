// Secrets Manager 路由

import { LIMITS } from './config/limits';
import { handleMachineAccounts } from './handlers/sm-machine-accounts';
import { handleProjects } from './handlers/sm-projects';
import { handleSecrets } from './handlers/sm-secrets';
import { AuthService } from './services/auth';
import { getClientIdentifier, RateLimitService } from './services/ratelimit';
import { SecretsManagerService } from './services/sm-service';
import type { Env } from './types';
import { errorResponse } from './utils/response';

/**
 * Secrets Manager 路由处理
 * 处理机器账号、项目、凭证等 Secrets Manager 相关请求
 */
export async function handleSmRoute(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  if (
    !path.startsWith('/api/sm/') &&
    !path.startsWith('/api/machine-accounts') &&
    !path.startsWith('/api/projects') &&
    !path.startsWith('/api/secrets')
  ) {
    return null;
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return errorResponse('未授权', 401);
  }

  const clientId = getClientIdentifier(request);
  if (!clientId) {
    return errorResponse('需要客户端 IP', 403);
  }

  // 首先尝试 Machine Account Token 认证
  const machineAuth = await verifyMachineToken(request, env);
  if (machineAuth) {
    const rateLimit = new RateLimitService(env.DB);
    const rateLimitCheck = await rateLimit.consumeBudget(
      `${clientId}:sm-machine`,
      LIMITS.rateLimit.sensitivePublicRequestsPerMinute
    );
    if (!rateLimitCheck.allowed) {
      return errorResponse(
        `速率限制已超出，请在 ${rateLimitCheck.retryAfterSeconds} 秒后重试。`,
        429
      );
    }

    // Machine Account 只能访问被授权的 secrets
    if (path.startsWith('/api/secrets')) {
      return handleSecrets(request, env, path, method, machineAuth.userId, env.ENCRYPTION_KEY, machineAuth.machineAccountId);
    }
    return errorResponse('禁止：机器账号无法管理资源', 403);
  }

  // 尝试 User Token 认证
  const auth = new AuthService(env);
  const verified = await auth.verifyAccessTokenWithUser(authHeader);
  if (!verified) {
    return errorResponse('未授权', 401);
  }

  const userId = verified.user.id;

  if (path.startsWith('/api/machine-accounts')) {
    return handleMachineAccounts(request, env, path, method, userId);
  }

  if (path.startsWith('/api/projects')) {
    return handleProjects(request, env, path, method, userId);
  }

  if (path.startsWith('/api/secrets')) {
    return handleSecrets(request, env, path, method, userId, env.ENCRYPTION_KEY);
  }

  return null;
}

/**
 * 验证机器账号 Token
 * @returns 机器账号信息，无效则返回 null
 */
export async function verifyMachineToken(
  request: Request,
  env: Env
): Promise<{ machineAccountId: string; userId: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const smService = new SecretsManagerService(env.DB, env.ENCRYPTION_KEY);
  const machineAccount = await smService.verifyAccessToken(token);

  if (!machineAccount) {
    return null;
  }

  return {
    machineAccountId: machineAccount.id,
    userId: machineAccount.user_id,
  };
}

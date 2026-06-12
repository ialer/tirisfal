// Secrets Manager Router

import { LIMITS } from './config/limits';
import { handleMachineAccounts } from './handlers/sm-machine-accounts';
import { handleProjects } from './handlers/sm-projects';
import { handleSecrets } from './handlers/sm-secrets';
import { AuthService } from './services/auth';
import { getClientIdentifier, RateLimitService } from './services/ratelimit';
import { SecretsManagerService } from './services/sm-service';
import type { Env } from './types';
import { errorResponse } from './utils/response';

export async function handleSmRoute(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  // 检查是否是 Secrets Manager 路由
  if (
    !path.startsWith('/api/sm/') &&
    !path.startsWith('/api/machine-accounts') &&
    !path.startsWith('/api/projects') &&
    !path.startsWith('/api/secrets')
  ) {
    return null;
  }

  // 验证用户身份 - 支持 User Token 和 Machine Account Token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return errorResponse('Unauthorized', 401);
  }

  const clientId = getClientIdentifier(request);
  if (!clientId) {
    return errorResponse('Client IP is required', 403);
  }

  // 首先尝试 Machine Account Token
  const machineAuth = await verifyMachineToken(request, env);
  if (machineAuth) {
    // Machine Account 速率限制
    const rateLimit = new RateLimitService(env.DB);
    const rateLimitCheck = await rateLimit.consumeBudget(
      `${clientId}:sm-machine`,
      LIMITS.rateLimit.sensitivePublicRequestsPerMinute
    );
    if (!rateLimitCheck.allowed) {
      return errorResponse(
        `Rate limit exceeded. Try again in ${rateLimitCheck.retryAfterSeconds} seconds.`,
        429
      );
    }

    // Machine Account 只能访问被授权的 secrets
    if (path.startsWith('/api/secrets')) {
      return handleSecrets(request, env, path, method, machineAuth.userId, env.ENCRYPTION_KEY, machineAuth.machineAccountId);
    }
    // Machine Account 不能管理 machine-accounts 或 projects
    return errorResponse('Forbidden: Machine accounts cannot manage resources', 403);
  }

  // 尝试 User Token
  const auth = new AuthService(env);
  const verified = await auth.verifyAccessTokenWithUser(authHeader);
  if (!verified) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = verified.user.id;

  // 处理机器账号路由
  if (path.startsWith('/api/machine-accounts')) {
    return handleMachineAccounts(request, env, path, method, userId);
  }

  // 处理项目路由
  if (path.startsWith('/api/projects')) {
    return handleProjects(request, env, path, method, userId);
  }

  // 处理凭证路由
  if (path.startsWith('/api/secrets')) {
    return handleSecrets(request, env, path, method, userId, env.ENCRYPTION_KEY);
  }

  return null;
}

  // 机器账号 Token 验证路由
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
